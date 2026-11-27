import io
import uuid
from datetime import timedelta

from django.core.files.base import ContentFile
from django.db.models import Max, Q
from django.utils import timezone
from django.http import FileResponse, Http404, JsonResponse
from django.shortcuts import get_object_or_404
from rest_framework import generics, status
from rest_framework.decorators import api_view
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from PIL import Image, ImageOps, UnidentifiedImageError

from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction

from . import notifications, resume_checks
from .models import (
    REPORTS_TO_FLAG,
    Block,
    BugReport,
    Certification,
    Connection,
    ConnectionRequest,
    Education,
    Message,
    Profile,
    ProfileReport,
    Resume,
    WorkExperience,
)
from .serializers import (
    ALLOWED_AVATAR_CONTENT_TYPES,
    MAX_AVATAR_SIZE,
    MAX_RESUME_SIZE,
    CertificationSerializer,
    ConnectionRequestSerializer,
    ConnectionSerializer,
    EducationSerializer,
    MessageSerializer,
    ProfileSerializer,
    WorkExperienceSerializer,
)


def health(request):
    return JsonResponse({"success": True, "message": "UPSA Django backend is running!"})


def _connection_or_404(request, pk):
    connection = get_object_or_404(Connection, pk=pk)
    if not connection.includes(request.user.id):
        raise Http404
    return connection


def _ensure_can_interact(user):
    """Refuse anything that reaches out to another member (requests, accepts,
    messages, resumes) from a disabled, suspended or self-deactivated account.
    Hiding someone from Discover alone isn't enough - they'd still be able to
    contact everyone they already know. Declining and cancelling stay allowed,
    since those only ever reduce contact."""
    if not user.is_active:
        raise PermissionDenied("This account has been disabled.")
    profile = Profile.objects.filter(user=user).only("hidden", "deactivated").first()
    if profile is None:
        return
    if profile.deactivated:
        raise PermissionDenied("Your account has been suspended.")
    if profile.hidden:
        raise PermissionDenied("Your account is deactivated. Reactivate it in Settings first.")


def _text_field(data, key):
    """A free-text field from a hand-parsed body. JSON lets a client send a
    number, list or object where text belongs, and slicing/stripping those
    would crash with a 500, so anything that isn't text is a 400."""
    value = data.get(key)
    if value is None:
        return ""
    if not isinstance(value, str):
        raise ValidationError({key: "Must be text."})
    return value


def _visible_profiles():
    return Profile.objects.filter(hidden=False, deactivated=False, user__is_active=True)


def blocked_between(a_id, b_id):
    """True if either person has blocked the other. A block always works both
    ways, so the blocked person can't simply reach out from their side."""
    return Block.objects.filter(Q(blocker_id=a_id, blocked_id=b_id) | Q(blocker_id=b_id, blocked_id=a_id)).exists()


def _blocked_ids(user):
    """Everyone this user has blocked or been blocked by."""
    pairs = Block.objects.filter(Q(blocker=user) | Q(blocked=user)).values_list("blocker_id", "blocked_id")
    return {b if a == user.id else a for a, b in pairs}


# How long someone has to wait before asking a member again after that member
# declined them - long enough that "no" sticks, short enough that it isn't
# permanent (blocking is the permanent option).
REQUEST_COOLDOWN = timedelta(days=30)


# --- Member / profile ---------------------------------------------------


class MyProfileView(generics.RetrieveUpdateAPIView):
    serializer_class = ProfileSerializer

    def get_object(self):
        profile, _ = Profile.objects.get_or_create(user=self.request.user)
        return profile

    def delete(self, request, *args, **kwargs):
        # The whole account, not just the profile - cascades to education,
        # experience, certifications, connections, requests and messages, and
        # (via portal.signals) the avatar and any shared resume files on R2.
        # This only removes the backend side; the frontend also calls Clerk's
        # own self-serve deletion so the auth account itself goes away too.
        request.user.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class MemberProfileView(generics.RetrieveAPIView):
    serializer_class = ProfileSerializer
    lookup_url_kwarg = "user_id"
    lookup_field = "user_id"

    def get_queryset(self):
        # A block hides both people's profiles from each other.
        return _visible_profiles().exclude(user_id__in=_blocked_ids(self.request.user))


# --- Education / experience / certifications --------------------------------
# Each is managed through its own my-profile-only list, with onboarding_complete
# recomputed after every change since the main photo/bio/etc. profile save
# isn't what touches these rows.


class _MyEntryListCreateView(generics.ListCreateAPIView):
    """Shared by education/experience/certifications: list and add entries on
    the signed-in member's own profile. related_name on the model (set by
    each subclass) is both the queryset relation and the Profile field name."""

    pagination_class = None
    related_name = None

    def get_queryset(self):
        profile, _ = Profile.objects.get_or_create(user=self.request.user)
        return getattr(profile, self.related_name).all()

    def perform_create(self, serializer):
        profile, _ = Profile.objects.get_or_create(user=self.request.user)
        serializer.save(profile=profile)


class _MyEntryDetailView(generics.RetrieveUpdateDestroyAPIView):
    """Shared by education/experience/certifications: edit/delete one entry -
    ownership enforced in the query, same as everywhere else in this API."""

    related_name = None

    def get_queryset(self):
        return self.model.objects.filter(profile__user=self.request.user)


class EducationListCreateView(_MyEntryListCreateView):
    serializer_class = EducationSerializer
    related_name = "education"


class EducationDetailView(_MyEntryDetailView):
    serializer_class = EducationSerializer
    model = Education


class WorkExperienceListCreateView(_MyEntryListCreateView):
    serializer_class = WorkExperienceSerializer
    related_name = "experience"


class WorkExperienceDetailView(_MyEntryDetailView):
    serializer_class = WorkExperienceSerializer
    model = WorkExperience


class CertificationListCreateView(_MyEntryListCreateView):
    serializer_class = CertificationSerializer
    related_name = "certifications"


class CertificationDetailView(_MyEntryDetailView):
    serializer_class = CertificationSerializer
    model = Certification


@api_view(["POST"])
def report_member(request, user_id):
    if user_id == request.user.id:
        raise ValidationError("You can't report yourself.")
    reported_user = get_object_or_404(get_user_model(), pk=user_id)
    reason = _text_field(request.data, "reason")[:300]

    try:
        with transaction.atomic():
            ProfileReport.objects.create(reporter=request.user, reported=reported_user, reason=reason)
    except IntegrityError:
        # Already reported this profile - not an error, just a no-op.
        return Response(status=status.HTTP_200_OK)

    report_count = ProfileReport.objects.filter(reported=reported_user).count()
    if report_count >= REPORTS_TO_FLAG:
        profile, _ = Profile.objects.get_or_create(user=reported_user)
        if not profile.flagged_for_review:
            profile.flagged_for_review = True
            profile.save(update_fields=["flagged_for_review"])

    return Response(status=status.HTTP_201_CREATED)


report_member.cls.throttle_scope = "reports"


@api_view(["POST", "DELETE"])
def block_member(request, user_id):
    """POST blocks, DELETE unblocks. Both are idempotent, and neither needs
    any staff involvement or tells the other person."""
    if user_id == request.user.id:
        raise ValidationError("You can't block yourself.")
    target = get_object_or_404(get_user_model(), pk=user_id)

    if request.method == "DELETE":
        Block.objects.filter(blocker=request.user, blocked=target).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    me = request.user
    now = timezone.now()
    with transaction.atomic():
        Block.objects.get_or_create(blocker=me, blocked=target)
        # End everything open between the two of them. updated_at moves too,
        # so both people's portals pick it up on their next sync.
        ConnectionRequest.objects.filter(status="pending").filter(
            Q(from_user=me, to_user=target) | Q(from_user=target, to_user=me)
        ).update(status="cancelled", updated_at=now)
        Connection.objects.exclude(status="cancelled").filter(
            Q(member_a=me, member_b=target) | Q(member_a=target, member_b=me)
        ).update(status="cancelled", updated_at=now)
    return Response(status=status.HTTP_201_CREATED)


block_member.cls.throttle_scope = "blocks"


@api_view(["GET"])
def list_blocks(request):
    """The people I've blocked, for the Unblock list in Settings. Only name
    and photo: their profile is otherwise hidden from me."""
    blocks = Block.objects.filter(blocker=request.user).select_related("blocked__profile")
    rows = []
    for block in blocks:
        profile = getattr(block.blocked, "profile", None)
        rows.append({
            "id": block.blocked_id,
            "name": (profile.name if profile and profile.name else "Former member"),
            "avatarUrl": profile.avatar.url if profile and profile.avatar else None,
            "blockedAt": block.created_at,
        })
    return Response(rows)


@api_view(["POST"])
def submit_bug_report(request):
    description = _text_field(request.data, "description").strip()
    if not description:
        raise ValidationError("Description can't be empty.")
    page_url = _text_field(request.data, "pageUrl")[:500]
    BugReport.objects.create(reporter=request.user, description=description[:2000], page_url=page_url)
    return Response(status=status.HTTP_201_CREATED)


submit_bug_report.cls.throttle_scope = "bug_reports"


AVATAR_SIZE = 256
# Covers a full-resolution 48MP phone photo. The cap exists because a
# decoded image costs about 3-4 bytes per pixel in memory - several uploads
# at once near the old 150MP limit could run a small server out of memory.
MAX_AVATAR_PIXELS = 50_000_000
# Only what the upload form offers. Without this Pillow will open any format
# it knows (TIFF, PSD, EPS...) whatever content type the browser claimed,
# and each of those parsers is more attack surface for no benefit.
AVATAR_FORMATS = ["JPEG", "PNG", "WEBP"]


def _avatar_thumbnail(upload):
    """A small WebP copy of the uploaded photo.

    Avatars are shown at 40 to 100 pixels, so storing and serving a full-size
    original for each would make every page heavy. This also proves the file
    really is an image, and refuses absurdly large dimensions (a tiny file can
    decompress into gigabytes of pixels).
    """
    try:
        image = Image.open(upload, formats=AVATAR_FORMATS)
        if image.width * image.height > MAX_AVATAR_PIXELS:
            raise ValidationError("That photo is too large. Try one under 50 megapixels.")
        # JPEGs can be decoded straight at a fraction of full size, so even a
        # 48MP photo only ever takes a few MB of memory here. Other formats
        # ignore this and decode at full size (still within the cap above).
        image.draft(image.mode, (AVATAR_SIZE * 2, AVATAR_SIZE * 2))
        image.load()
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError):
        raise ValidationError("That file isn't a valid image.")
    image = ImageOps.exif_transpose(image)
    image.thumbnail((AVATAR_SIZE, AVATAR_SIZE))
    if image.mode not in ("RGB", "RGBA"):
        image = image.convert("RGBA" if "transparency" in image.info else "RGB")
    buffer = io.BytesIO()
    image.save(buffer, "WEBP", quality=82)
    # A random name, not a fixed "avatar.webp" - avatars are cached by
    # browsers/CDN as immutable for a year (see storage.py), so reusing the
    # same name on a later upload would mean the new photo never displays:
    # the old cached bytes at that exact URL would never be re-fetched. A
    # fixed name would also briefly collide with whatever's mid-cleanup from
    # the previous replace (see portal/signals.py).
    return ContentFile(buffer.getvalue(), name=f"{uuid.uuid4().hex}.webp")


@api_view(["POST", "DELETE"])
def upload_avatar(request):
    profile, _ = Profile.objects.get_or_create(user=request.user)

    if request.method == "DELETE":
        if profile.avatar:
            profile.avatar = None
            profile.refresh_onboarding_complete()
            profile.save(update_fields=["avatar", "onboarding_complete"])
        return Response(ProfileSerializer(profile, context={"request": request}).data)

    file = request.FILES.get("file")
    if not file:
        raise ValidationError("No file uploaded.")
    if file.content_type not in ALLOWED_AVATAR_CONTENT_TYPES:
        raise ValidationError("Profile photo must be a JPG, PNG, or WEBP image.")
    if file.size > MAX_AVATAR_SIZE:
        raise ValidationError("Profile photo must be under 20MB.")

    profile.avatar = _avatar_thumbnail(file)
    profile.refresh_onboarding_complete()
    profile.save(update_fields=["avatar", "onboarding_complete"])
    return Response(ProfileSerializer(profile, context={"request": request}).data, status=status.HTTP_201_CREATED)


upload_avatar.cls.throttle_scope = "uploads"


# --- Discover -------------------------------------------------------------


class ProfessionalListView(generics.ListAPIView):
    serializer_class = ProfileSerializer

    def get_queryset(self):
        # Anyone with a fully completed profile is discoverable - student or
        # professional, not just the latter (see Profile.is_actually_complete).
        # A declined/cancelled request doesn't hide two people from each
        # other; an actual connection does, but only on the plain unfiltered
        # browse - they already have their own spot in Connections. The
        # moment someone actually searches or filters, they're looking for a
        # specific person/criteria and a connection shouldn't vanish from
        # those results just because they're already connected.
        user = self.request.user
        params = self.request.query_params
        has_filters = bool(
            params.get("search") or params.get("company") or params.get("industry")
            or params.get("university") or params.get("referralsAvailable") == "true"
        )

        qs = _visible_profiles().filter(onboarding_complete=True).exclude(user=user).exclude(user_id__in=_blocked_ids(user))

        if not has_filters:
            connected_ids = set()
            pairs = Connection.objects.filter(Q(member_a=user) | Q(member_b=user)).exclude(status="cancelled").values_list(
                "member_a_id", "member_b_id"
            )
            for a, b in pairs:
                connected_ids.add(b if a == user.id else a)
            qs = qs.exclude(user_id__in=connected_ids)

        if search := params.get("search"):
            qs = qs.filter(
                Q(name__icontains=search)
                | Q(headline__icontains=search)
                | Q(role__icontains=search)
                | Q(company__icontains=search)
                | Q(skills__icontains=search)
            )
        if company := params.get("company"):
            qs = qs.filter(company__icontains=company)
        if industry := params.get("industry"):
            qs = qs.filter(industry__icontains=industry)
        if university := params.get("university"):
            qs = qs.filter(university__icontains=university)
        if params.get("referralsAvailable") == "true":
            qs = qs.filter(referrals_available=True)
        # Each card includes education/experience/certifications. Without
        # prefetching, that's 3 more queries per profile - 60 extra per page.
        return qs.order_by("name").prefetch_related("education", "experience", "certifications")


# --- Connection requests ----------------------------------------------------


class ConnectionRequestListCreateView(generics.ListCreateAPIView):
    serializer_class = ConnectionRequestSerializer
    pagination_class = None
    throttle_scope = "requests"

    def get_queryset(self):
        user = self.request.user
        if self.request.query_params.get("direction") == "outgoing":
            return ConnectionRequest.objects.filter(from_user=user)
        return ConnectionRequest.objects.filter(to_user=user)

    def perform_create(self, serializer):
        user = self.request.user
        _ensure_can_interact(user)
        to_user_id = serializer.validated_data["to_user_id"]
        if to_user_id == user.id:
            raise ValidationError("You can't send a request to yourself.")
        # Only someone you could actually find in Discover: this also turns a
        # made-up id into a clean 400 instead of a foreign-key crash, and keeps
        # requests away from hidden/suspended members and staff accounts that
        # never made a profile.
        target = _visible_profiles().filter(user_id=to_user_id, onboarding_complete=True).first()
        # A block gets the same answer as a missing member, so it doesn't
        # reveal that you were blocked.
        if target is None or blocked_between(user.id, to_user_id):
            raise ValidationError("That member isn't available to connect with.")
        if serializer.validated_data["request_type"] == "referral" and not target.referrals_available:
            raise ValidationError("This member isn't taking referral requests right now.")

        # A plain "does an open request already exist" check has a race: two
        # near-simultaneous sends (a double-click, a flaky retry) can both
        # pass it before either has committed. Locking both users' rows first
        # - in a stable, lowest-id-first order so two opposite-direction
        # sends at the same moment can't deadlock each other - makes a second
        # concurrent send wait here until the first one has actually
        # committed, so it sees the real up-to-date state.
        with transaction.atomic():
            list(
                get_user_model()
                .objects.select_for_update()
                .filter(pk__in=sorted([user.id, to_user_id]))
                .order_by("pk")
            )

            open_between = ConnectionRequest.objects.filter(status="pending").filter(
                Q(from_user=user, to_user_id=to_user_id) | Q(from_user_id=to_user_id, to_user=user)
            )
            if open_between.exists():
                raise ValidationError("There's already an open request between you two.")

            already_connected = Connection.objects.exclude(status="cancelled").filter(
                Q(member_a=user, member_b_id=to_user_id) | Q(member_a_id=to_user_id, member_b=user)
            )
            if already_connected.exists():
                raise ValidationError("You're already connected with this member.")

            last_declined = (
                ConnectionRequest.objects.filter(from_user=user, to_user_id=to_user_id, status="declined")
                .order_by("-updated_at")
                .first()
            )
            if last_declined and last_declined.updated_at > timezone.now() - REQUEST_COOLDOWN:
                retry_on = (last_declined.updated_at + REQUEST_COOLDOWN).date()
                raise ValidationError(
                    f"This member declined your last request. You can send another after {retry_on:%B} {retry_on.day}."
                )

            notifications.request_received(serializer.save(from_user=user))


@api_view(["POST"])
def accept_request(request, pk):
    # select_for_update + status="pending" closes the race a plain get()
    # would leave open: two near-simultaneous accepts (a double-click, two
    # open tabs) could otherwise both read status="pending" before either
    # commits, and the second would crash on the Connection's one-to-one
    # constraint instead of cleanly 404ing.
    _ensure_can_interact(request.user)
    with transaction.atomic():
        req = get_object_or_404(
            ConnectionRequest.objects.select_for_update(), pk=pk, to_user=request.user, status="pending"
        )
        if blocked_between(req.from_user_id, req.to_user_id):
            raise ValidationError("This request can't be accepted.")
        req.status = "accepted"
        req.save(update_fields=["status", "updated_at"])
        # A connection is either active or cancelled - there's no separate
        # "mark complete" step (see cancel_connection for the only move).
        # The database refuses a second live connection for the same pair
        # (Connection.Meta.constraints), e.g. if the other person's request
        # to me was accepted first.
        try:
            with transaction.atomic():
                connection = Connection.objects.create(
                    request=req, member_a=req.from_user, member_b=req.to_user, status="active"
                )
        except IntegrityError:
            raise ValidationError("You're already connected with this member.")
    notifications.request_accepted(req)
    return Response(ConnectionSerializer(connection, context={"request": request}).data, status=status.HTTP_201_CREATED)


@api_view(["POST"])
def decline_request(request, pk):
    req = get_object_or_404(ConnectionRequest, pk=pk, to_user=request.user, status="pending")
    req.status = "declined"
    req.save(update_fields=["status", "updated_at"])
    return Response(ConnectionRequestSerializer(req).data)


@api_view(["POST"])
def cancel_request(request, pk):
    req = get_object_or_404(ConnectionRequest, pk=pk, from_user=request.user, status="pending")
    req.status = "cancelled"
    req.save(update_fields=["status", "updated_at"])
    return Response(ConnectionRequestSerializer(req).data)


# --- Connections ------------------------------------------------------------


class ConnectionListView(generics.ListAPIView):
    serializer_class = ConnectionSerializer
    pagination_class = None

    def get_queryset(self):
        user = self.request.user
        return Connection.objects.filter(Q(member_a=user) | Q(member_b=user))


@api_view(["POST"])
def cancel_connection(request, pk):
    connection = _connection_or_404(request, pk)
    connection.status = "cancelled"
    connection.save(update_fields=["status", "updated_at"])
    return Response(ConnectionSerializer(connection, context={"request": request}).data)


@api_view(["POST"])
def mark_connection_read(request, pk):
    """The member has this conversation open: everything in it up to now
    counts as read. Allowed on cancelled connections too - reading old
    messages doesn't reach out to anyone."""
    connection = _connection_or_404(request, pk)
    connection.mark_read(request.user.id, timezone.now())
    return Response(ConnectionSerializer(connection, context={"request": request}).data)


@api_view(["GET"])
def sync(request):
    """A tiny "has anything changed?" check for the portal's background refresh.

    Returns a version string that changes whenever one of my requests or
    connections changes (a connection's timestamp also moves on every new
    message). The portal asks this every 30 seconds and only downloads real
    data when the version differs, so thousands of idle tabs cost almost
    nothing: two indexed queries and a few bytes.
    """
    user = request.user
    requests_at = ConnectionRequest.objects.filter(Q(from_user=user) | Q(to_user=user)).aggregate(latest=Max("updated_at"))["latest"]
    connections_at = Connection.objects.filter(Q(member_a=user) | Q(member_b=user)).aggregate(latest=Max("updated_at"))["latest"]
    latest = max((t for t in (requests_at, connections_at) if t), default=None)
    return Response({"version": latest.isoformat() if latest else "0"})


# --- Messages ---------------------------------------------------------------


MESSAGES_PER_THREAD = 200


def _record_message(connection, sender, text, **extra):
    """Create a message, update the connection's cached preview, and notify
    the other member. Shared by plain text messages and a resume share
    (which is also just a message, with an attachment)."""
    message = Message.objects.create(connection=connection, sender=sender, text=text, **extra)
    Connection.objects.filter(pk=connection.pk).update(
        last_message_at=message.created_at,
        last_message_text=message.text[:140],
        last_message_sender_id=message.sender_id,
        # Writing in a conversation means you've read it up to here.
        **{connection.last_read_field(sender.id): message.created_at},
        updated_at=timezone.now(),
    )
    notifications.message_received(message)
    return message


def _ensure_can_message(connection):
    if connection.status == "cancelled":
        raise ValidationError("This connection is cancelled, no new messages.")
    # Blocking cancels the connection, but check directly too so nothing
    # else (a future "reconnect" path, a race) can let a message through.
    if blocked_between(connection.member_a_id, connection.member_b_id):
        raise PermissionDenied("You can't message this member.")


class ConnectionMessagesView(generics.ListCreateAPIView):
    serializer_class = MessageSerializer
    pagination_class = None
    throttle_scope = "messages"

    def _connection(self):
        return _connection_or_404(self.request, self.kwargs["pk"])

    def get_queryset(self):
        # The latest MESSAGES_PER_THREAD, oldest first. A long-running
        # conversation must never make this request slower over time.
        connection = self._connection()
        latest_ids = Message.objects.filter(connection=connection).order_by("-id").values_list("id", flat=True)[:MESSAGES_PER_THREAD]
        # select_related: one query for the whole thread instead of one more
        # per resume message.
        return Message.objects.filter(id__in=list(latest_ids)).select_related("resume").order_by("created_at", "id")

    def perform_create(self, serializer):
        _ensure_can_interact(self.request.user)
        connection = self._connection()
        _ensure_can_message(connection)
        message = _record_message(connection, self.request.user, serializer.validated_data["text"])
        serializer.instance = message


# --- Resume -------------------------------------------------------------


@api_view(["POST"])
def share_resume(request, pk):
    _ensure_can_interact(request.user)
    connection = _connection_or_404(request, pk)
    # Same rules as plain messages - a resume is just a message with a file.
    _ensure_can_message(connection)
    file = request.FILES.get("file")
    if not file:
        raise ValidationError("No file uploaded.")
    if file.size > MAX_RESUME_SIZE:
        raise ValidationError("Resume must be under 5MB.")
    # Checked from the file's actual bytes plus its extension, not the
    # content type the browser claims (see resume_checks.py).
    kind = resume_checks.resume_kind(file)
    file.name = resume_checks.safe_resume_name(file.name, kind)

    resume = Resume.objects.create(sender=request.user, file=file)
    message = _record_message(connection, request.user, "Shared a resume", attachment="resume", resume=resume)
    return Response(MessageSerializer(message).data, status=status.HTTP_201_CREATED)


share_resume.cls.throttle_scope = "uploads"


@api_view(["GET"])
def download_resume(request, pk):
    # Local dev storage only for now: streamed straight from disk with an
    # ownership/sharing check on every request. Once resumes move to R2,
    # swap this for handing back a short-lived signed URL instead.
    resume = get_object_or_404(Resume, pk=pk)
    message = resume.share_messages.first()
    if message is None or not message.connection.includes(request.user.id):
        raise Http404

    # The same name shown in the chat (already cleaned up at upload).
    filename = resume.display_name or resume.file.name.rsplit("/", 1)[-1]
    return FileResponse(resume.file.open("rb"), as_attachment=True, filename=filename)
