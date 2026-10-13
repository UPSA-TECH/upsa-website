from django.contrib import admin

from .models import Connection, ConnectionRequest, Message, Profile, ProfileReport, Resume


@admin.register(Profile)
class ProfileAdmin(admin.ModelAdmin):
    list_display = ["name", "user", "is_professional", "company", "flagged_for_review", "deactivated"]
    list_filter = ["is_professional", "flagged_for_review", "deactivated"]
    search_fields = ["name", "company", "user__username"]
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
        ("Moderation", {
            "fields": ["flagged_for_review"],
            "description": "Set automatically once enough members report this profile (see Reports below). "
                            "Deactivate the account yourself if it turns out to be fake.",
        }),
        ("Availability", {"fields": ["referrals_available"]}),
        ("Account", {"fields": ["deactivated", "email_notifications", "avatar"]}),
    ]


@admin.register(ProfileReport)
class ProfileReportAdmin(admin.ModelAdmin):
    list_display = ["reported", "reporter", "reason", "created_at"]
    search_fields = ["reported__username", "reporter__username", "reason"]
    ordering = ["-created_at"]
    readonly_fields = ["reporter", "reported", "reason", "created_at"]


admin.site.register(ConnectionRequest)
admin.site.register(Connection)
admin.site.register(Message)
admin.site.register(Resume)
