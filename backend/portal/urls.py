from django.urls import path

from . import views

urlpatterns = [
    path("health/", views.health, name="health"),
    path("members/me/", views.MyProfileView.as_view(), name="my-profile"),
    path("members/me/avatar/", views.upload_avatar, name="upload-avatar"),
    path("members/me/education/", views.EducationListCreateView.as_view(), name="education-list"),
    path("members/me/education/<int:pk>/", views.EducationDetailView.as_view(), name="education-detail"),
    path("members/me/experience/", views.WorkExperienceListCreateView.as_view(), name="experience-list"),
    path("members/me/experience/<int:pk>/", views.WorkExperienceDetailView.as_view(), name="experience-detail"),
    path("members/me/certifications/", views.CertificationListCreateView.as_view(), name="certifications-list"),
    path("members/me/certifications/<int:pk>/", views.CertificationDetailView.as_view(), name="certifications-detail"),
    path("members/<int:user_id>/", views.MemberProfileView.as_view(), name="member-profile"),
    path("members/<int:user_id>/report/", views.report_member, name="member-report"),
    path("bug-reports/", views.submit_bug_report, name="bug-report-submit"),
    path("sync/", views.sync, name="sync"),
    path("professionals/", views.ProfessionalListView.as_view(), name="professionals"),
    path("requests/", views.ConnectionRequestListCreateView.as_view(), name="requests"),
    path("requests/<int:pk>/accept/", views.accept_request, name="request-accept"),
    path("requests/<int:pk>/decline/", views.decline_request, name="request-decline"),
    path("requests/<int:pk>/cancel/", views.cancel_request, name="request-cancel"),
    path("connections/", views.ConnectionListView.as_view(), name="connections"),
    path("connections/<int:pk>/cancel/", views.cancel_connection, name="connection-cancel"),
    path("connections/<int:pk>/share-resume/", views.share_resume, name="connection-share-resume"),
    path("connections/<int:pk>/messages/", views.ConnectionMessagesView.as_view(), name="connection-messages"),
    path("resume/<int:pk>/download/", views.download_resume, name="resume-download"),
]
