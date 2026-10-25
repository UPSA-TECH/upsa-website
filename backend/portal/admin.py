from django.contrib import admin

from .models import BugReport, Connection, ConnectionRequest, Message, Profile, ProfileReport, Resume


@admin.register(Profile)
class ProfileAdmin(admin.ModelAdmin):
    list_display = ["name", "user", "onboarding_complete", "is_professional", "company", "university", "flagged_for_review", "deactivated"]
    list_filter = ["onboarding_complete", "is_professional", "flagged_for_review", "deactivated"]
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
                            "when this is True AND deactivated is False. To filter the list below to who's "
                            "actually discoverable right now, filter by Onboarding complete = Yes and "
                            "Deactivated = No at the same time.",
        }),
        ("Moderation", {
            "fields": ["flagged_for_review"],
            "description": "Set automatically once enough members report this profile (see Reports below). "
                            "Deactivate the account yourself if it turns out to be fake.",
        }),
        ("Availability", {"fields": ["referrals_available"]}),
        ("Account", {"fields": ["deactivated", "email_notifications", "avatar"]}),
    ]
    readonly_fields = ["onboarding_complete", "terms_accepted_at"]


@admin.register(ProfileReport)
class ProfileReportAdmin(admin.ModelAdmin):
    list_display = ["reported", "reporter", "reason", "created_at"]
    search_fields = ["reported__username", "reporter__username", "reason"]
    ordering = ["-created_at"]
    readonly_fields = ["reporter", "reported", "reason", "created_at"]


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
