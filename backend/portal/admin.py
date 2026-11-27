from django.contrib import admin

from .admin_security import LockoutAdminAuthenticationForm
from .models import AdminLoginFailure, Block, BugReport, Connection, ConnectionRequest, Message, Profile, ProfileReport, Resume

# Repeated failed sign-ins lock that username / IP out for a while
# (portal/admin_security.py). The admin's address comes from DJANGO_ADMIN_URL.
admin.site.login_form = LockoutAdminAuthenticationForm
admin.site.site_header = "UPSA Portal admin"


@admin.register(AdminLoginFailure)
class AdminLoginFailureAdmin(admin.ModelAdmin):
    # Read-only audit trail of failed admin sign-ins; rows expire after a day.
    list_display = ["username", "ip_address", "failed_at"]
    search_fields = ["username", "ip_address"]
    readonly_fields = ["username", "ip_address", "failed_at"]

    def has_add_permission(self, request):
        return False


@admin.register(Profile)
class ProfileAdmin(admin.ModelAdmin):
    list_display = ["name", "user", "onboarding_complete", "is_professional", "company", "university", "flagged_for_review", "hidden", "deactivated"]
    list_filter = ["onboarding_complete", "is_professional", "flagged_for_review", "hidden", "deactivated"]
    search_fields = ["name", "company", "university", "user__username"]
    ordering = ["-flagged_for_review", "name"]
    fieldsets = [
        (None, {"fields": ["user", "name", "headline", "bio", "skills"]}),
        ("Education", {"fields": ["university", "major"]}),
        ("Professional", {
            "fields": ["is_professional", "company", "role", "industry", "location"],
            "description": "is_professional is self-serve - the member sets it themselves once "
                            "company + role are filled in. No admin review step; see flagged_for_review "
                            "below for the reactive alternative.",
        }),
        ("Discover visibility", {
            "fields": ["onboarding_complete", "terms_accepted_at"],
            "description": "onboarding_complete is read-only here - it's recomputed automatically from "
                            "name/photo/bio/location plus either the student or professional fields, "
                            "every time the member saves their profile. A member shows up in Discover only "
                            "when this is True AND both hidden and deactivated are False.",
        }),
        ("Moderation", {
            "fields": ["flagged_for_review", "deactivated"],
            "description": "flagged_for_review is set automatically once enough members report this profile "
                            "(see Reports below). Tick deactivated to suspend someone: they disappear from "
                            "Discover and can't send requests, messages or resumes, and unlike hidden they "
                            "can't undo it themselves. To lock them out completely, untick Active on their "
                            "user under Authentication and Authorization.",
        }),
        ("Availability", {"fields": ["referrals_available"]}),
        ("Account", {
            "fields": ["hidden", "email_notifications", "avatar"],
            "description": "hidden is the member's own Deactivate/Reactivate switch in Settings.",
        }),
    ]
    readonly_fields = ["onboarding_complete", "terms_accepted_at"]


@admin.register(ProfileReport)
class ProfileReportAdmin(admin.ModelAdmin):
    list_display = ["reported", "reporter", "reason", "created_at"]
    search_fields = ["reported__username", "reporter__username", "reason"]
    ordering = ["-created_at"]
    readonly_fields = ["reporter", "reported", "reason", "created_at"]


@admin.register(Block)
class BlockAdmin(admin.ModelAdmin):
    # Read-only record: members block and unblock themselves from Settings.
    list_display = ["blocker", "blocked", "created_at"]
    search_fields = ["blocker__username", "blocked__username"]
    readonly_fields = ["blocker", "blocked", "created_at"]


@admin.register(BugReport)
class BugReportAdmin(admin.ModelAdmin):
    list_display = ["reporter", "short_description", "page_url", "created_at"]
    search_fields = ["reporter__username", "description", "page_url"]
    ordering = ["-created_at"]
    readonly_fields = ["reporter", "description", "page_url", "created_at"]

    def short_description(self, obj):
        return obj.description[:80] + ("…" if len(obj.description) > 80 else "")


admin.site.register(ConnectionRequest)
admin.site.register(Connection)
admin.site.register(Message)
admin.site.register(Resume)
