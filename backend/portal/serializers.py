from rest_framework import serializers

from .models import (
    REQUEST_TYPE_CHOICES,
    Certification,
    Connection,
    ConnectionRequest,
    Education,
    Message,
    Profile,
    WorkExperience,
)

MAX_RESUME_SIZE = 5 * 1024 * 1024
ALLOWED_RESUME_CONTENT_TYPES = {
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}

# Free-text caps. The database columns are unbounded TextFields, so without
# these a single member could store megabytes in a bio or message that then
# gets served to everyone who loads their profile or the conversation.
MAX_BIO_LENGTH = 2000
MAX_DESCRIPTION_LENGTH = 2000
MAX_REQUEST_MESSAGE_LENGTH = 600  # matches the request modal's own limit
MAX_MESSAGE_LENGTH = 4000
MAX_SKILLS = 30
MAX_SKILL_LENGTH = 50

MAX_AVATAR_SIZE = 20 * 1024 * 1024
ALLOWED_AVATAR_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp"}


def _size_label(num_bytes):
    if num_bytes < 1024:
        return f"{num_bytes} B"
    if num_bytes < 1024 * 1024:
        return f"{num_bytes // 1024} KB"
    return f"{num_bytes / (1024 * 1024):.1f} MB"


class EducationSerializer(serializers.ModelSerializer):
    fieldOfStudy = serializers.CharField(source="field_of_study", required=False, allow_blank=True)
    startYear = serializers.IntegerField(source="start_year", required=False, allow_null=True)
    endYear = serializers.IntegerField(source="end_year", required=False, allow_null=True)
    currentlyStudying = serializers.BooleanField(source="currently_studying", required=False)

    class Meta:
        model = Education
        fields = ["id", "school", "degree", "fieldOfStudy", "startYear", "endYear", "currentlyStudying"]


class WorkExperienceSerializer(serializers.ModelSerializer):
    jobTitle = serializers.CharField(source="job_title")
    employmentType = serializers.CharField(source="employment_type", required=False, allow_blank=True)
    startDate = serializers.DateField(source="start_date", required=False, allow_null=True)
    endDate = serializers.DateField(source="end_date", required=False, allow_null=True)
    currentlyWorking = serializers.BooleanField(source="currently_working", required=False)

    class Meta:
        model = WorkExperience
        fields = ["id", "jobTitle", "company", "employmentType", "startDate", "endDate", "currentlyWorking", "description"]
        extra_kwargs = {"description": {"max_length": MAX_DESCRIPTION_LENGTH}}


class CertificationSerializer(serializers.ModelSerializer):
    issuingOrganization = serializers.CharField(source="issuing_organization", required=False, allow_blank=True)
    issueDate = serializers.DateField(source="issue_date", required=False, allow_null=True)
    expirationDate = serializers.DateField(source="expiration_date", required=False, allow_null=True)
    credentialUrl = serializers.URLField(source="credential_url", required=False, allow_blank=True)

    class Meta:
        model = Certification
        fields = ["id", "name", "issuingOrganization", "issueDate", "expirationDate", "credentialUrl"]


class ProfileSerializer(serializers.ModelSerializer):
    id = serializers.IntegerField(source="user_id", read_only=True)
    bio = serializers.CharField(max_length=MAX_BIO_LENGTH, required=False, allow_blank=True)
    # The column is free-form JSON, so without this anything (an object,
    # nested lists, a huge blob) could be saved and then served to everyone
    # in Discover - where the frontend expects a short list of strings.
    skills = serializers.ListField(
        child=serializers.CharField(max_length=MAX_SKILL_LENGTH),
        max_length=MAX_SKILLS,
        required=False,
    )
    referralsAvailable = serializers.BooleanField(source="referrals_available", required=False)
    # Self-serve: a member can set this to True themselves, but only once
    # company + role are filled in (checked in update() below, since it needs
    # both the incoming and already-saved values). No admin review - see
    # Profile.is_professional's comment for why.
    isProfessional = serializers.BooleanField(source="is_professional", required=False)
    avatarUrl = serializers.SerializerMethodField()
    hasAvatar = serializers.SerializerMethodField()
    # Admin-only suspension - shown so the portal can tell the member, never
    # writable, or a suspended member could just PATCH it back off. The
    # member's own deactivate/reactivate switch is "hidden".
    deactivated = serializers.BooleanField(read_only=True)
    emailNotifications = serializers.BooleanField(source="email_notifications", required=False)
    onboardingComplete = serializers.BooleanField(source="onboarding_complete", read_only=True)
    termsAccepted = serializers.SerializerMethodField()
    # Write-only: {"acceptTerms": true} records acceptance now. There's no
    # way to un-accept - once sent it just stays true.
    acceptTerms = serializers.BooleanField(write_only=True, required=False)
    # Read-only here - managed through their own /members/me/<kind>/ endpoints
    # below, not through a PATCH to the profile itself (each entry has its own
    # id to edit/delete, which doesn't fit a single flat profile PATCH).
    education = EducationSerializer(many=True, read_only=True)
    experience = WorkExperienceSerializer(many=True, read_only=True)
    certifications = CertificationSerializer(many=True, read_only=True)

    class Meta:
        model = Profile
        fields = [
            "id",
            "name",
            "headline",
            "university",
            "major",
            "company",
            "role",
            "industry",
            "location",
            "bio",
            "skills",
            "referralsAvailable",
            "isProfessional",
            "hidden",
            "deactivated",
            "avatarUrl",
            "hasAvatar",
            "emailNotifications",
            "onboardingComplete",
            "termsAccepted",
            "acceptTerms",
            "education",
            "experience",
            "certifications",
        ]

    def validate_skills(self, skills):
        # Skills render as React list keys, so drop repeats (first one wins).
        return list(dict.fromkeys(skill for skill in skills if skill))

    def get_termsAccepted(self, obj):
        return obj.terms_accepted_at is not None

    def to_representation(self, instance):
        data = super().to_representation(instance)
        # A private preference: only the owner ever sees it.
        request = self.context.get("request")
        if request is None or request.user.id != instance.user_id:
            data.pop("emailNotifications", None)
        return data

    def get_avatarUrl(self, obj):
        return obj.avatar.url if obj.avatar else None

    def get_hasAvatar(self, obj):
        return bool(obj.avatar)

    def update(self, instance, validated_data):
        wants_listed = validated_data.get("is_professional")
        if wants_listed:
            company = validated_data.get("company", instance.company)
            role = validated_data.get("role", instance.role)
            if not (company or "").strip() or not (role or "").strip():
                raise serializers.ValidationError(
                    {"isProfessional": "Add a company and job title before listing yourself."}
                )
        accept_terms = validated_data.pop("acceptTerms", False)
        for field, value in validated_data.items():
            setattr(instance, field, value)
        if accept_terms and instance.terms_accepted_at is None:
            from django.utils import timezone

            instance.terms_accepted_at = timezone.now()
        instance.refresh_onboarding_complete()
        instance.save()
        return instance


class ConnectionRequestSerializer(serializers.ModelSerializer):
    fromId = serializers.IntegerField(source="from_user_id", read_only=True)
    toId = serializers.IntegerField(source="to_user_id")
    requestType = serializers.ChoiceField(source="request_type", choices=REQUEST_TYPE_CHOICES)
    createdAt = serializers.DateTimeField(source="created_at", read_only=True)

    class Meta:
        model = ConnectionRequest
        fields = ["id", "fromId", "toId", "requestType", "message", "status", "createdAt"]
        read_only_fields = ["id", "status"]
        extra_kwargs = {"message": {"max_length": MAX_REQUEST_MESSAGE_LENGTH}}


class ConnectionSerializer(serializers.ModelSerializer):
    requestId = serializers.IntegerField(source="request_id", read_only=True)
    memberIds = serializers.SerializerMethodField()
    lastMessage = serializers.SerializerMethodField()
    # When the requesting member last had this conversation open. Only ever
    # their own - the other member's read state isn't exposed (no read receipts).
    lastReadAt = serializers.SerializerMethodField()

    class Meta:
        model = Connection
        fields = ["id", "requestId", "memberIds", "status", "since", "lastMessage", "lastReadAt"]

    def get_lastReadAt(self, obj):
        request = self.context.get("request")
        if request is None or not obj.includes(request.user.id):
            return None
        # Returned raw, like lastMessage.createdAt, so both go through the same
        # JSON encoder and come out in the identical ISO format - the frontend
        # compares the two as strings.
        return obj.last_read_at_for(request.user.id)

    def get_lastMessage(self, obj):
        if obj.last_message_at is None:
            return None
        return {"text": obj.last_message_text, "senderId": obj.last_message_sender_id, "createdAt": obj.last_message_at}

    def get_memberIds(self, obj):
        return [obj.member_a_id, obj.member_b_id]


class MessageSerializer(serializers.ModelSerializer):
    connectionId = serializers.IntegerField(source="connection_id", read_only=True)
    senderId = serializers.IntegerField(source="sender_id", read_only=True)
    createdAt = serializers.DateTimeField(source="created_at", read_only=True)
    resumeId = serializers.SerializerMethodField()
    resumeFileName = serializers.SerializerMethodField()
    resumeSizeLabel = serializers.SerializerMethodField()

    class Meta:
        model = Message
        fields = ["id", "connectionId", "senderId", "text", "createdAt", "attachment", "resumeId", "resumeFileName", "resumeSizeLabel"]
        extra_kwargs = {"text": {"max_length": MAX_MESSAGE_LENGTH}}

    def get_resumeId(self, obj):
        return obj.resume_id

    def get_resumeFileName(self, obj):
        return obj.resume.file.name.rsplit("/", 1)[-1] if obj.resume else None

    def get_resumeSizeLabel(self, obj):
        return _size_label(obj.resume.file.size) if obj.resume else None
