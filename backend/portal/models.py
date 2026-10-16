from django.conf import settings
from django.db import models

from .storage import avatar_storage, resume_storage

REQUEST_TYPE_CHOICES = [
    ("connect", "Connect"),
    ("referral", "Referral"),
]

REQUEST_STATUS_CHOICES = [
    ("pending", "Pending"),
    ("accepted", "Accepted"),
    ("declined", "Declined"),
    ("cancelled", "Cancelled"),
]

CONNECTION_STATUS_CHOICES = [
    ("active", "Active"),
    ("completed", "Completed"),
    ("cancelled", "Cancelled"),
]


def avatar_upload_path(instance, filename):
    return f"avatars/{instance.user_id}/{filename}"


class Profile(models.Model):
    """A member's portal profile. One per Django user, created on first
    touch of /api/members/me/ rather than at sign-up time."""

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="profile")
    avatar = models.ImageField(upload_to=avatar_upload_path, storage=avatar_storage, blank=True, null=True)
    name = models.CharField(max_length=150, blank=True)
    headline = models.CharField(max_length=200, blank=True)
    university = models.CharField(max_length=200, blank=True)
    major = models.CharField(max_length=200, blank=True)
    company = models.CharField(max_length=200, blank=True)
    role = models.CharField(max_length=200, blank=True)
    industry = models.CharField(max_length=200, blank=True)
    location = models.CharField(max_length=200, blank=True)
    bio = models.TextField(blank=True)
    skills = models.JSONField(default=list, blank=True)
    # The only visibility opt-in left: a verified professional is discoverable
    # by default (see ProfessionalListView), this just controls whether they're
    # open to being asked for a job referral specifically - a bigger ask than a
    # normal "let's connect" request, worth opting into separately.
    referrals_available = models.BooleanField(default=False)
    # Self-serve: a member sets this themselves once they've filled in
    # company + role (enforced in the serializer), no admin review. There's no
    # real way to verify anyone's claimed employer anyway - LinkedIn has the
    # same gap - so a review step was only ever a speed bump, not a check.
    # REPORTS_TO_FLAG reports instead flags a profile for an admin to look at
    # after the fact (see ProfileReport below).
    is_professional = models.BooleanField(default=False)
    deactivated = models.BooleanField(default=False)
    email_notifications = models.BooleanField(default=True)
    flagged_for_review = models.BooleanField(default=False)

    class Meta:
        indexes = [models.Index(fields=["is_professional", "deactivated"])]

    def __str__(self):
        return self.name or f"profile:{self.user_id}"


# How many distinct members reporting the same profile flags it for an admin.
REPORTS_TO_FLAG = 3


class ProfileReport(models.Model):
    """A member flagging another member's profile as fake/suspicious.

    Reactive moderation, not pre-approval: anyone can list themselves as a
    professional the moment they fill in company + role, and this is the
    backstop if that gets abused - once REPORTS_TO_FLAG distinct people report
    the same profile, it's flagged for an admin to look at (see admin.py).
    """

    reporter = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="reports_filed")
    reported = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="reports_received")
    reason = models.CharField(max_length=300, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["reporter", "reported"], name="one_report_per_reporter_per_profile"),
        ]

    def __str__(self):
        return f"{self.reporter_id} reported {self.reported_id}"


class ConnectionRequest(models.Model):
    from_user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="sent_requests")
    to_user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="received_requests")
    request_type = models.CharField(max_length=20, choices=REQUEST_TYPE_CHOICES)
    message = models.TextField(blank=True)
    status = models.CharField(max_length=20, choices=REQUEST_STATUS_CHOICES, default="pending")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["to_user", "status"]),
            models.Index(fields=["from_user", "status"]),
        ]

    def __str__(self):
        return f"{self.from_user_id} -> {self.to_user_id} ({self.request_type}, {self.status})"


class Connection(models.Model):
    request = models.OneToOneField(ConnectionRequest, on_delete=models.CASCADE, related_name="connection")
    member_a = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="connections_as_a")
    member_b = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="connections_as_b")
    status = models.CharField(max_length=20, choices=CONNECTION_STATUS_CHOICES, default="active")
    since = models.DateTimeField(auto_now_add=True)
    # Bumped on any change, including a new message. The portal asks "has
    # anything changed?" with a single cheap query on this instead of
    # re-downloading everything.
    updated_at = models.DateTimeField(auto_now=True)
    # The latest message, kept here so listing connections shows a preview
    # without a query per connection.
    last_message_at = models.DateTimeField(null=True, blank=True)
    last_message_text = models.CharField(max_length=140, blank=True)
    last_message_sender_id = models.IntegerField(null=True, blank=True)

    class Meta:
        ordering = ["-since"]

    def includes(self, user_id):
        return user_id in (self.member_a_id, self.member_b_id)


ATTACHMENT_CHOICES = [
    ("resume", "Resume"),
]


class Message(models.Model):
    connection = models.ForeignKey(Connection, on_delete=models.CASCADE, related_name="messages")
    sender = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="sent_messages")
    text = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)
    # A resume share shows up as a real message in the chat (not a separate
    # button elsewhere), so both people see it in the conversation and it
    # syncs like any other message. SET_NULL so an old share message still
    # renders (as "no longer available") if the resume is later replaced.
    attachment = models.CharField(max_length=20, choices=ATTACHMENT_CHOICES, blank=True)
    resume = models.ForeignKey("Resume", on_delete=models.SET_NULL, null=True, blank=True, related_name="share_messages")

    class Meta:
        ordering = ["created_at"]
        indexes = [models.Index(fields=["connection", "created_at"])]


def resume_upload_path(instance, filename):
    return f"resumes/{instance.sender_id}/{filename}"


class Resume(models.Model):
    """A file sent straight from someone's computer into a chat message - not
    a profile fixture. Each share is its own upload, never reused or replaced
    in place, same as any other chat attachment."""

    sender = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="shared_resumes")
    file = models.FileField(upload_to=resume_upload_path, storage=resume_storage)
    uploaded_at = models.DateTimeField(auto_now_add=True)
