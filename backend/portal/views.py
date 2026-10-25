import io

from django.core.files.base import ContentFile
from django.db.models import Max, Q
from django.utils import timezone
from django.http import FileResponse, Http404, JsonResponse
from django.shortcuts import get_object_or_404
from rest_framework import generics, status
from rest_framework.decorators import api_view
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from PIL import Image, ImageOps, UnidentifiedImageError

from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction

from . import notifications
from .models import (
    REPORTS_TO_FLAG,
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
    ALLOWED_RESUME_CONTENT_TYPES,
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
    queryset = Profile.objects.filter(deactivated=False)
    lookup_url_kwarg = "user_id"
    lookup_field = "user_id"


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
    reason = (request.data.get("reason") or "")[:300]

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


@api_view(["POST"])
def submit_bug_report(request):
    description = (request.data.get("description") or "").strip()
    if not description:
        raise ValidationError("Description can't be empty.")
    page_url = (request.data.get("pageUrl") or "")[:500]
    BugReport.objects.create(reporter=request.user, description=description[:2000], page_url=page_url)
    return Response(status=status.HTTP_201_CREATED)


submit_bug_report.cls.throttle_scope = "bug_reports"


AVATAR_SIZE = 256
# Comfortably above any real camera photo (a 108MP phone sensor tops out
# around 108_000_000, a wide panorama a bit more) - this exists to block
# decompression-bomb files, not legitimate high-res photos.
MAX_AVATAR_PIXELS = 150_000_000


def _avatar_thumbnail(upload):
    """A small WebP copy of the uploaded photo.

    Avatars are shown at 40 to 100 pixels, so storing and serving a full-size
    original for each would make every page heavy. This also proves the file
    really is an image, and refuses absurdly large dimensions (a tiny file can
    decompress into gigabytes of pixels).
    """
    try:
        image = Image.open(upload)
        if image.width * image.height > MAX_AVATAR_PIXELS:
            raise ValidationError("That image's dimensions are too large.")
        image.load()
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError):
        raise ValidationError("That file isn't a valid image.")
    image = ImageOps.exif_transpose(image)
    image.thumbnail((AVATAR_SIZE, AVATAR_SIZE))
    if image.mode not in ("RGB", "RGBA"):
        image = image.convert("RGBA" if "transparency" in image.info else "RGB")
    buffer = io.BytesIO()
    image.save(buffer, "WEBP", quality=82)
    return ContentFile(buffer.getvalue(), name="avatar.webp")


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
        # other; an actual connection does, since at that point they belong
        # in each other's Connections list instead.
        user = self.request.user
        connected_ids = set()
        pairs = Connection.objects.filter(Q(member_a=user) | Q(member_b=user)).exclude(status="cancelled").values_list(
            "member_a_id", "member_b_id"
        )
        for a, b in pairs:
            connected_ids.add(b if a == user.id else a)

        qs = (
            Profile.objects.filter(onboarding_complete=True, deactivated=False)
            .exclude(user=user)
            .exclude(user_id__in=connected_ids)
        )
        params = self.request.query_params
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
        return qs.order_by("name")


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
        to_user_id = serializer.validated_data["to_user_id"]
        if to_user_id == user.id:
            raise ValidationError("You can't send a request to yourself.")

        open_between = ConnectionRequest.objects.filter(status="pending").filter(
            Q(from_user=user, to_user_id=to_user_id) | Q(from_user_id=to_user_id, to_user=user)
        )
        if open_between.exists():
            raise ValidationError("There's already an open request between you two.")

        notifications.request_received(serializer.save(from_user=user))


@api_view(["POST"])
def accept_request(request, pk):
    req = get_object_or_404(ConnectionRequest, pk=pk, to_user=request.user, status="pending")
    req.status = "accepted"
    req.save(update_fields=["status", "updated_at"])
    # Accepting is the whole lifecycle now - there's no separate "mark
    # complete" step after the fact (see cancel_connection for the only
    # other state a connection can move to).
    connection = Connection.objects.create(request=req, member_a=req.from_user, member_b=req.to_user, status="completed")
    notifications.request_accepted(req)
    return Response(ConnectionSerializer(connection).data, status=status.HTTP_201_CREATED)


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
    return Response(ConnectionSerializer(connection).data)


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
        updated_at=timezone.now(),
    )
    notifications.message_received(message)
    return message


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
        return Message.objects.filter(id__in=list(latest_ids)).order_by("created_at", "id")

    def perform_create(self, serializer):
        connection = self._connection()
        if connection.status == "cancelled":
            raise ValidationError("This connection is cancelled, no new messages.")
        message = _record_message(connection, self.request.user, serializer.validated_data["text"])
        serializer.instance = message


# --- Resume -------------------------------------------------------------


@api_view(["POST"])
def share_resume(request, pk):
    connection = _connection_or_404(request, pk)
    file = request.FILES.get("file")
    if not file:
        raise ValidationError("No file uploaded.")
    if file.content_type not in ALLOWED_RESUME_CONTENT_TYPES:
        raise ValidationError("Resume must be a PDF, DOC, or DOCX file.")
    if file.size > MAX_RESUME_SIZE:
        raise ValidationError("Resume must be under 5MB.")

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

    filename = resume.file.name.rsplit("/", 1)[-1]
    return FileResponse(resume.file.open("rb"), as_attachment=True, filename=filename)
