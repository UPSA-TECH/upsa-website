import tempfile
from datetime import timedelta
from unittest import mock

from django.contrib.auth import get_user_model
from django.core import mail
from django.core.cache import cache
from django.core.files.storage import FileSystemStorage
from django.test import RequestFactory, SimpleTestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework.settings import api_settings
from rest_framework.test import APITestCase
from rest_framework.throttling import SimpleRateThrottle

from django.db import IntegrityError, transaction

from .models import Block, Certification, Connection, ConnectionRequest, Education, Message, Profile, Resume, WorkExperience
from users.models import ClerkIdentity

from .storage import avatar_storage, resume_storage

User = get_user_model()


@override_settings(MEDIA_ROOT=tempfile.mkdtemp())
class PortalApiTests(APITestCase):
    def setUp(self):
        self.student = User.objects.create(username="clerk:student")
        self.mentor = User.objects.create(username="clerk:mentor")

    def as_(self, user):
        self.client.force_authenticate(user=user)

    def complete_profile(self, user, **fields):
        """Fills in everything Profile.is_actually_complete() requires (name,
        photo, bio, location, plus whichever of the student/professional
        field sets isn't overridden away), then applies any extra fields."""
        self.as_(user)
        self.client.post(reverse("upload-avatar"), {"file": _fake_image()}, format="multipart")
        payload = {
            "name": f"Member {user.id}",
            "bio": "Happy to chat.",
            "location": "Remote",
            "company": "Acme",
            "role": "Engineer",
        }
        payload.update(fields)
        res = self.client.patch(reverse("my-profile"), payload, format="json")
        self.assertEqual(res.status_code, 200, res.data)
        return res

    # --- profile ---------------------------------------------------------

    def test_profile_created_lazily_and_patchable(self):
        self.as_(self.student)
        res = self.client.get(reverse("my-profile"))
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["id"], self.student.id)

        res = self.client.patch(
            reverse("my-profile"),
            {"bio": "Backend curious junior", "referralsAvailable": True},
            format="json",
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["bio"], "Backend curious junior")
        self.assertEqual(res.data["referralsAvailable"], True)

    def test_deleting_my_account_removes_everything_attached_to_it(self):
        self.as_(self.student)
        with self.captureOnCommitCallbacks(execute=True):
            self.client.post(reverse("upload-avatar"), {"file": _fake_image()}, format="multipart")
        avatar_name, storage = Profile.objects.get(user=self.student).avatar.name, avatar_storage()

        req = ConnectionRequest.objects.create(from_user=self.student, to_user=self.mentor, request_type="connect")
        connection = Connection.objects.create(request=req, member_a=self.student, member_b=self.mentor)
        Message.objects.create(connection=connection, sender=self.student, text="hi")

        with self.captureOnCommitCallbacks(execute=True):
            res = self.client.delete(reverse("my-profile"))
        self.assertEqual(res.status_code, 204)

        self.assertFalse(User.objects.filter(pk=self.student.id).exists())
        self.assertFalse(Profile.objects.filter(user_id=self.student.id).exists())
        self.assertFalse(ConnectionRequest.objects.filter(pk=req.id).exists())
        self.assertFalse(Connection.objects.filter(pk=connection.id).exists())
        self.assertFalse(Message.objects.filter(connection_id=connection.id).exists())
        self.assertFalse(storage.exists(avatar_name))

    def test_cannot_list_yourself_without_company_and_role(self):
        self.as_(self.student)
        res = self.client.patch(reverse("my-profile"), {"isProfessional": True}, format="json")
        self.assertEqual(res.status_code, 400)
        self.assertFalse(Profile.objects.get(user=self.student).is_professional)

        # half-filled still isn't enough
        res = self.client.patch(reverse("my-profile"), {"company": "Microsoft", "isProfessional": True}, format="json")
        self.assertEqual(res.status_code, 400)
        self.assertFalse(Profile.objects.get(user=self.student).is_professional)

    def test_member_can_self_serve_list_as_professional_no_admin_wait(self):
        self.as_(self.student)
        res = self.client.patch(
            reverse("my-profile"),
            {"company": "Microsoft", "role": "SWE", "industry": "Technology", "location": "Seattle, WA", "isProfessional": True},
            format="json",
        )
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data["isProfessional"])
        self.assertTrue(Profile.objects.get(user=self.student).is_professional)

    def test_a_self_deactivated_member_disappears_from_discover_and_can_come_back(self):
        # hidden (the Settings "Deactivate account" switch), not isProfessional,
        # is the real Discover opt-out - see
        # test_discover_needs_a_fully_completed_profile for why.
        self.complete_profile(self.student)
        self.as_(self.student)
        res = self.client.patch(reverse("my-profile"), {"hidden": True}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data["hidden"])

        self.as_(self.mentor)
        ids = [m["id"] for m in self.client.get(reverse("professionals")).data["results"]]
        self.assertNotIn(self.student.id, ids)
        self.assertEqual(self.client.get(reverse("member-profile", args=[self.student.id])).status_code, 404)

        self.as_(self.student)
        self.client.patch(reverse("my-profile"), {"hidden": False}, format="json")
        self.as_(self.mentor)
        ids = [m["id"] for m in self.client.get(reverse("professionals")).data["results"]]
        self.assertIn(self.student.id, ids)

    def test_a_member_cannot_lift_their_own_suspension(self):
        self.complete_profile(self.student)
        Profile.objects.filter(user=self.student).update(deactivated=True)

        self.as_(self.student)
        res = self.client.patch(reverse("my-profile"), {"deactivated": False, "hidden": False}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data["deactivated"])
        self.assertTrue(Profile.objects.get(user=self.student).deactivated)

        self.as_(self.mentor)
        ids = [m["id"] for m in self.client.get(reverse("professionals")).data["results"]]
        self.assertNotIn(self.student.id, ids)
        self.assertEqual(self.client.get(reverse("member-profile", args=[self.student.id])).status_code, 404)

    def test_a_disabled_user_disappears_from_discover(self):
        self.complete_profile(self.student)
        User.objects.filter(pk=self.student.pk).update(is_active=False)

        self.as_(self.mentor)
        ids = [m["id"] for m in self.client.get(reverse("professionals")).data["results"]]
        self.assertNotIn(self.student.id, ids)
        self.assertEqual(self.client.get(reverse("member-profile", args=[self.student.id])).status_code, 404)

    def _restrict(self, user, how):
        if how == "inactive":
            User.objects.filter(pk=user.pk).update(is_active=False)
            user.refresh_from_db()
        else:
            Profile.objects.update_or_create(user=user, defaults={how: True})

    def test_restricted_accounts_cannot_reach_out_to_anyone(self):
        third = User.objects.create(username="clerk:third")
        for how in ("hidden", "deactivated", "inactive"):
            with self.subTest(how=how):
                student = User.objects.create(username=f"clerk:restricted-{how}")
                self.complete_profile(student)
                # an existing connection, and an incoming request waiting on them
                req = ConnectionRequest.objects.create(from_user=student, to_user=self.mentor, request_type="connect", status="accepted")
                connection = Connection.objects.create(request=req, member_a=student, member_b=self.mentor)
                incoming = ConnectionRequest.objects.create(from_user=third, to_user=student, request_type="connect")
                self._restrict(student, how)
                self.as_(student)

                res = self.client.post(reverse("requests"), {"toId": third.id, "requestType": "connect", "message": "hi"}, format="json")
                self.assertEqual(res.status_code, 403)
                self.assertFalse(ConnectionRequest.objects.filter(from_user=student, to_user=third).exists())

                res = self.client.post(reverse("request-accept", args=[incoming.id]))
                self.assertEqual(res.status_code, 403)
                incoming.refresh_from_db()
                self.assertEqual(incoming.status, "pending")

                res = self.client.post(reverse("connection-messages", args=[connection.id]), {"text": "hello"}, format="json")
                self.assertEqual(res.status_code, 403)

                resume = _fake_file(b"%PDF-1.4 fake resume", "resume.pdf", "application/pdf")
                res = self.client.post(reverse("connection-share-resume", args=[connection.id]), {"file": resume}, format="multipart")
                self.assertEqual(res.status_code, 403)

                self.assertFalse(Message.objects.filter(connection=connection).exists())
                self.assertFalse(Resume.objects.filter(sender=student).exists())

                # stepping back is still allowed
                self.assertEqual(self.client.post(reverse("request-decline", args=[incoming.id])).status_code, 200)

    def test_reactivating_restores_the_ability_to_reach_out(self):
        _discoverable(self.mentor)
        self.complete_profile(self.student)
        self.as_(self.student)
        self.client.patch(reverse("my-profile"), {"hidden": True}, format="json")
        blocked = self.client.post(reverse("requests"), {"toId": self.mentor.id, "requestType": "connect", "message": "hi"}, format="json")
        self.assertEqual(blocked.status_code, 403)

        self.client.patch(reverse("my-profile"), {"hidden": False}, format="json")
        allowed = self.client.post(reverse("requests"), {"toId": self.mentor.id, "requestType": "connect", "message": "hi"}, format="json")
        self.assertEqual(allowed.status_code, 201)

    def test_requests_only_go_to_members_you_could_find_in_discover(self):
        def send(to_id):
            return self.client.post(reverse("requests"), {"toId": to_id, "requestType": "connect", "message": "hi"}, format="json")

        unfinished = User.objects.create(username="clerk:unfinished")
        Profile.objects.create(user=unfinished, name="Half Done")
        no_profile = User.objects.create(username="clerk:staff")
        hidden = _discoverable(User.objects.create(username="clerk:hidden"), hidden=True)
        suspended = _discoverable(User.objects.create(username="clerk:suspended"), deactivated=True)
        inactive = _discoverable(User.objects.create(username="clerk:inactive"))
        User.objects.filter(pk=inactive.pk).update(is_active=False)

        self.as_(self.student)
        for target_id in (999999, unfinished.id, no_profile.id, hidden.id, suspended.id, inactive.id):
            with self.subTest(target_id=target_id):
                self.assertEqual(send(target_id).status_code, 400)
        self.assertFalse(ConnectionRequest.objects.exists())

        _discoverable(self.mentor)
        self.assertEqual(send(self.mentor.id).status_code, 201)

    def test_referral_requests_need_the_member_to_be_open_to_referrals(self):
        _discoverable(self.mentor, referrals_available=False)
        self.as_(self.student)
        body = {"toId": self.mentor.id, "requestType": "referral", "message": "could you refer me?"}
        self.assertEqual(self.client.post(reverse("requests"), body, format="json").status_code, 400)

        Profile.objects.filter(user=self.mentor).update(referrals_available=True)
        self.assertEqual(self.client.post(reverse("requests"), body, format="json").status_code, 201)

    def test_cannot_share_a_resume_on_a_cancelled_connection(self):
        req = ConnectionRequest.objects.create(from_user=self.student, to_user=self.mentor, request_type="connect", status="accepted")
        connection = Connection.objects.create(request=req, member_a=self.student, member_b=self.mentor, status="cancelled")
        self.as_(self.student)
        resume = _fake_file(b"%PDF-1.4 fake resume", "resume.pdf", "application/pdf")
        res = self.client.post(reverse("connection-share-resume", args=[connection.id]), {"file": resume}, format="multipart")
        self.assertEqual(res.status_code, 400)
        self.assertFalse(Resume.objects.exists())
        self.assertFalse(Message.objects.exists())

    def test_skills_must_be_a_short_list_of_short_strings(self):
        self.as_(self.student)
        for bad in ({"a": 1}, "python", [["nested"]], [{"x": 1}], ["x" * 51], [f"s{i}" for i in range(31)]):
            with self.subTest(skills=bad):
                res = self.client.patch(reverse("my-profile"), {"skills": bad}, format="json")
                self.assertEqual(res.status_code, 400)
        res = self.client.patch(reverse("my-profile"), {"skills": ["React", "Finance", "React"]}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["skills"], ["React", "Finance"])

    def test_free_text_fields_are_capped(self):
        _discoverable(self.mentor)
        self.as_(self.student)
        self.assertEqual(self.client.patch(reverse("my-profile"), {"bio": "x" * 2001}, format="json").status_code, 400)
        self.assertEqual(self.client.patch(reverse("my-profile"), {"bio": "x" * 2000}, format="json").status_code, 200)

        too_long = {"toId": self.mentor.id, "requestType": "connect", "message": "x" * 601}
        self.assertEqual(self.client.post(reverse("requests"), too_long, format="json").status_code, 400)

        req = ConnectionRequest.objects.create(from_user=self.student, to_user=self.mentor, request_type="connect", status="accepted")
        connection = Connection.objects.create(request=req, member_a=self.student, member_b=self.mentor)
        url = reverse("connection-messages", args=[connection.id])
        self.assertEqual(self.client.post(url, {"text": "x" * 4001}, format="json").status_code, 400)
        self.assertEqual(self.client.post(url, {"text": "x" * 4000}, format="json").status_code, 201)

        res = self.client.post(reverse("experience-list"), {"jobTitle": "SWE", "company": "Acme", "description": "x" * 2001}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_non_text_report_and_bug_report_fields_are_a_400_not_a_crash(self):
        self.as_(self.student)
        for payload in ({"reason": 5}, {"reason": ["a"]}, {"reason": {"x": 1}}):
            with self.subTest(payload=payload):
                res = self.client.post(reverse("member-report", args=[self.mentor.id]), payload, format="json")
                self.assertEqual(res.status_code, 400)
        for payload in ({"description": 5}, {"description": "broken", "pageUrl": ["x"]}):
            with self.subTest(payload=payload):
                self.assertEqual(self.client.post(reverse("bug-report-submit"), payload, format="json").status_code, 400)
        self.assertEqual(self.client.post(reverse("bug-report-submit"), {"description": "broken"}, format="json").status_code, 201)

    # --- reporting -----------------------------------------------------

    def test_reporting_a_profile(self):
        self.as_(self.mentor)
        self.client.get(reverse("my-profile"))  # lazily creates their profile row, same as real usage
        self.as_(self.student)
        res = self.client.post(reverse("member-report", args=[self.mentor.id]), {"reason": "seems fake"}, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertFalse(Profile.objects.get(user=self.mentor).flagged_for_review)  # just 1 report so far

    def test_cannot_report_yourself(self):
        self.as_(self.student)
        res = self.client.post(reverse("member-report", args=[self.student.id]), format="json")
        self.assertEqual(res.status_code, 400)

    def test_reporting_the_same_profile_twice_is_a_no_op(self):
        self.as_(self.student)
        self.client.post(reverse("member-report", args=[self.mentor.id]), format="json")
        res = self.client.post(reverse("member-report", args=[self.mentor.id]), format="json")
        self.assertEqual(res.status_code, 200)
        from .models import ProfileReport

        self.assertEqual(ProfileReport.objects.filter(reported=self.mentor).count(), 1)

    def test_three_distinct_reports_flags_the_profile(self):
        self.as_(self.mentor)
        self.client.get(reverse("my-profile"))  # lazily creates their profile row, same as real usage
        reporters = [User.objects.create(username=f"clerk:reporter{i}") for i in range(3)]
        for reporter in reporters:
            self.as_(reporter)
            self.client.post(reverse("member-report", args=[self.mentor.id]), format="json")
        self.assertTrue(Profile.objects.get(user=self.mentor).flagged_for_review)

    # --- bug reports -----------------------------------------------------

    def test_submitting_a_bug_report(self):
        self.as_(self.student)
        res = self.client.post(
            reverse("bug-report-submit"),
            {"description": "the discover page is blank", "pageUrl": "/portal/discover"},
            format="json",
        )
        self.assertEqual(res.status_code, 201)
        from .models import BugReport

        report = BugReport.objects.get()
        self.assertEqual(report.reporter, self.student)
        self.assertEqual(report.description, "the discover page is blank")
        self.assertEqual(report.page_url, "/portal/discover")

    def test_bug_report_needs_a_description(self):
        self.as_(self.student)
        res = self.client.post(reverse("bug-report-submit"), {"pageUrl": "/portal/discover"}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_avatar_upload_validation(self):
        self.as_(self.student)

        wrong_type = _fake_file(b"not an image", "photo.txt", "text/plain")
        res = self.client.post(reverse("upload-avatar"), {"file": wrong_type}, format="multipart")
        self.assertEqual(res.status_code, 400)

        too_big = _fake_image(mb=21)
        res = self.client.post(reverse("upload-avatar"), {"file": too_big}, format="multipart")
        self.assertEqual(res.status_code, 400)

        good = _fake_image()
        res = self.client.post(reverse("upload-avatar"), {"file": good}, format="multipart")
        self.assertEqual(res.status_code, 201)
        self.assertTrue(res.data["hasAvatar"])
        self.assertIsNotNone(res.data["avatarUrl"])

    def test_avatar_can_be_removed(self):
        self.as_(self.student)
        self.client.post(reverse("upload-avatar"), {"file": _fake_image()}, format="multipart")

        res = self.client.delete(reverse("upload-avatar"))
        self.assertEqual(res.status_code, 200)
        self.assertFalse(res.data["hasAvatar"])
        self.assertIsNone(res.data["avatarUrl"])

        # removing when there's nothing to remove is a harmless no-op
        res = self.client.delete(reverse("upload-avatar"))
        self.assertEqual(res.status_code, 200)
        self.assertFalse(res.data["hasAvatar"])

    # --- discover ----------------------------------------------------------

    def test_discover_needs_a_fully_completed_profile(self):
        # Half-done doesn't count, even for a self-listed professional -
        # name/photo/bio/location are mandatory too, not just company+role.
        self.as_(self.mentor)
        self.client.patch(
            reverse("my-profile"),
            {"company": "Microsoft", "role": "PM", "isProfessional": True},
            format="json",
        )

        # A complete *student* profile is just as discoverable as a complete
        # professional one - Discover isn't segmented by which type you are.
        complete_student = User.objects.create(username="clerk:complete-student")
        self.complete_profile(complete_student, company="", role="", university="UCF", major="CS")

        complete_pro = User.objects.create(username="clerk:complete-pro")
        self.complete_profile(complete_pro)

        self.as_(self.student)
        res = self.client.get(reverse("professionals"))
        self.assertEqual(res.status_code, 200)
        ids = [m["id"] for m in res.data["results"]]
        self.assertNotIn(self.mentor.id, ids)
        self.assertIn(complete_student.id, ids)
        self.assertIn(complete_pro.id, ids)

    def test_skills_and_industry_are_optional_but_location_is_not(self):
        no_skills_no_industry = User.objects.create(username="clerk:no-skills")
        self.complete_profile(no_skills_no_industry, skills=[], industry="")
        self.assertTrue(Profile.objects.get(user=no_skills_no_industry).onboarding_complete)

        no_location = User.objects.create(username="clerk:no-location")
        self.complete_profile(no_location, location="")
        self.assertFalse(Profile.objects.get(user=no_location).onboarding_complete)

    def test_discover_never_shows_yourself(self):
        self.complete_profile(self.mentor)
        res = self.client.get(reverse("professionals"))
        ids = [m["id"] for m in res.data["results"]]
        self.assertNotIn(self.mentor.id, ids)

    def test_discover_can_filter_to_referrals_only(self):
        self.complete_profile(self.mentor, referralsAvailable=True)
        no_referrals = User.objects.create(username="clerk:no-referrals-pro2")
        self.complete_profile(no_referrals, referralsAvailable=False)

        self.as_(self.student)
        res = self.client.get(reverse("professionals"), {"referralsAvailable": "true"})
        ids = [m["id"] for m in res.data["results"]]
        self.assertIn(self.mentor.id, ids)
        self.assertNotIn(no_referrals.id, ids)

    def test_discover_search_matches_name_and_skills(self):
        self.complete_profile(self.mentor, name="Mentor Mia", skills=["Distributed Systems", "Go"])
        self.as_(self.student)

        def found(term):
            res = self.client.get(reverse("professionals"), {"search": term})
            return [m["id"] for m in res.data["results"]]

        self.assertEqual(found("mia"), [self.mentor.id])
        self.assertEqual(found("distributed"), [self.mentor.id])
        self.assertEqual(found("nobody-has-this"), [])

    def test_discover_is_paginated_at_twenty(self):
        for i in range(25):
            pro = User.objects.create(username=f"clerk:pro{i}")
            self.complete_profile(pro, name=f"Pro {i:02d}")
        self.as_(self.student)
        page1 = self.client.get(reverse("professionals"))
        self.assertEqual(len(page1.data["results"]), 20)
        self.assertIsNotNone(page1.data["next"])
        page2 = self.client.get(reverse("professionals"), {"page": 2})
        self.assertEqual(len(page2.data["results"]), 5)
        self.assertIsNone(page2.data["next"])

    def test_connecting_hides_each_other_from_discover_but_a_declined_request_does_not(self):
        self.complete_profile(self.mentor)
        self.complete_profile(self.student)

        self.as_(self.student)
        ids = [m["id"] for m in self.client.get(reverse("professionals")).data["results"]]
        self.assertIn(self.mentor.id, ids)  # not connected yet - still shows

        req = ConnectionRequest.objects.create(from_user=self.student, to_user=self.mentor, request_type="connect")
        self.as_(self.mentor)
        self.client.post(reverse("request-decline", args=[req.id]))
        self.as_(self.student)
        ids = [m["id"] for m in self.client.get(reverse("professionals")).data["results"]]
        self.assertIn(self.mentor.id, ids)  # declined, not connected - still shows

        req2 = ConnectionRequest.objects.create(from_user=self.student, to_user=self.mentor, request_type="connect")
        self.as_(self.mentor)
        self.client.post(reverse("request-accept", args=[req2.id]))
        self.as_(self.student)
        ids = [m["id"] for m in self.client.get(reverse("professionals")).data["results"]]
        self.assertNotIn(self.mentor.id, ids)  # now connected - hidden from Discover
        self.as_(self.mentor)
        ids = [m["id"] for m in self.client.get(reverse("professionals")).data["results"]]
        self.assertNotIn(self.student.id, ids)

    def test_a_connection_still_turns_up_when_you_search_or_filter_for_them(self):
        # Hidden from the plain unfiltered browse (they're in Connections
        # already), but actually searching or filtering is a different
        # intent - you're looking for someone specific, and a connection
        # shouldn't become unfindable just because you're already connected.
        self.complete_profile(self.mentor)
        self.complete_profile(self.student)
        req = ConnectionRequest.objects.create(from_user=self.student, to_user=self.mentor, request_type="connect")
        self.as_(self.mentor)
        self.client.post(reverse("request-accept", args=[req.id]))

        self.as_(self.student)
        ids = [m["id"] for m in self.client.get(reverse("professionals")).data["results"]]
        self.assertNotIn(self.mentor.id, ids)

        # Fetched fresh rather than via self.mentor.profile - force_authenticate
        # reuses the same self.mentor instance across requests, so that cached
        # relation can still be the blank profile from the avatar-upload step.
        mentor_profile = Profile.objects.get(user=self.mentor)
        ids = [m["id"] for m in self.client.get(reverse("professionals"), {"search": mentor_profile.name}).data["results"]]
        self.assertIn(self.mentor.id, ids)

        ids = [m["id"] for m in self.client.get(reverse("professionals"), {"company": mentor_profile.company}).data["results"]]
        self.assertIn(self.mentor.id, ids)

    # --- requests / connections / messages ----------------------------------

    def test_full_request_to_message_flow(self):
        _discoverable(self.mentor)
        self.as_(self.student)
        res = self.client.post(
            reverse("requests"),
            {"toId": self.mentor.id, "requestType": "connect", "message": "hi!"},
            format="json",
        )
        self.assertEqual(res.status_code, 201)
        request_id = res.data["id"]

        # can't open a second request while one's already pending
        dupe = self.client.post(
            reverse("requests"),
            {"toId": self.mentor.id, "requestType": "connect", "message": "again"},
            format="json",
        )
        self.assertEqual(dupe.status_code, 400)

        # mentor sees it as incoming
        self.as_(self.mentor)
        incoming = self.client.get(reverse("requests"))
        self.assertEqual(len(incoming.data), 1)

        accept = self.client.post(reverse("request-accept", args=[request_id]))
        self.assertEqual(accept.status_code, 201)
        connection_id = accept.data["id"]
        self.assertEqual(set(accept.data["memberIds"]), {self.student.id, self.mentor.id})
        # a fresh connection is live - the dashboard's "Active connections"
        # counts exactly this status
        self.assertEqual(accept.data["status"], "active")
        listed = self.client.get(reverse("connections")).data
        self.assertEqual([c["status"] for c in listed], ["active"])

        # a stranger can't touch this connection
        stranger = User.objects.create(username="clerk:stranger")
        self.as_(stranger)
        blocked = self.client.get(reverse("connection-messages", args=[connection_id]))
        self.assertEqual(blocked.status_code, 404)

        self.as_(self.student)
        sent = self.client.post(reverse("connection-messages", args=[connection_id]), {"text": "thanks!"}, format="json")
        self.assertEqual(sent.status_code, 201)

        self.as_(self.mentor)
        thread = self.client.get(reverse("connection-messages", args=[connection_id]))
        self.assertEqual(len(thread.data), 1)
        self.assertEqual(thread.data[0]["text"], "thanks!")

        cancel = self.client.post(reverse("connection-cancel", args=[connection_id]))
        self.assertEqual(cancel.data["status"], "cancelled")

        blocked_msg = self.client.post(reverse("connection-messages", args=[connection_id]), {"text": "still there?"}, format="json")
        self.assertEqual(blocked_msg.status_code, 400)

    def test_accepting_an_already_accepted_request_404s_instead_of_crashing(self):
        # Simulates the second half of a double-accept race: by the time this
        # runs, the request is no longer "pending", which is exactly the
        # state a concurrent accept would leave behind.
        _discoverable(self.mentor)
        self.as_(self.student)
        res = self.client.post(reverse("requests"), {"toId": self.mentor.id, "requestType": "connect", "message": "hi"}, format="json")
        request_id = res.data["id"]

        self.as_(self.mentor)
        first = self.client.post(reverse("request-accept", args=[request_id]))
        self.assertEqual(first.status_code, 201)

        second = self.client.post(reverse("request-accept", args=[request_id]))
        self.assertEqual(second.status_code, 404)
        self.assertEqual(Connection.objects.filter(request_id=request_id).count(), 1)

    # --- resume --------------------------------------------------------------

    def test_resume_upload_validation_and_sharing(self):
        self.as_(self.student)

        req = ConnectionRequest.objects.create(from_user=self.student, to_user=self.mentor, request_type="connect")
        connection = Connection.objects.create(request=req, member_a=self.student, member_b=self.mentor)

        too_big = _fake_file(b"x" * (6 * 1024 * 1024), "resume.pdf", "application/pdf")
        res = self.client.post(reverse("connection-share-resume", args=[connection.id]), {"file": too_big}, format="multipart")
        self.assertEqual(res.status_code, 400)

        wrong_type = _fake_file(b"not a resume", "resume.exe", "application/octet-stream")
        res = self.client.post(reverse("connection-share-resume", args=[connection.id]), {"file": wrong_type}, format="multipart")
        self.assertEqual(res.status_code, 400)

        good = _fake_file(b"%PDF-1.4 fake resume", "resume.pdf", "application/pdf")
        share = self.client.post(reverse("connection-share-resume", args=[connection.id]), {"file": good}, format="multipart")
        self.assertEqual(share.status_code, 201)
        self.assertEqual(share.data["attachment"], "resume")
        self.assertEqual(share.data["resumeFileName"], "resume.pdf")
        resume_id = share.data["resumeId"]

        self.as_(self.mentor)
        allowed = self.client.get(reverse("resume-download", args=[resume_id]))
        self.assertEqual(allowed.status_code, 200)

        # a stranger outside the connection can't get it
        stranger = User.objects.create(username="clerk:stranger")
        self.as_(stranger)
        denied = self.client.get(reverse("resume-download", args=[resume_id]))
        self.assertEqual(denied.status_code, 404)

        # it's a real message both sides see in the conversation, not a side channel
        self.as_(self.student)
        thread = self.client.get(reverse("connection-messages", args=[connection.id]))
        self.assertEqual(len(thread.data), 1)
        self.assertEqual(thread.data[0]["attachment"], "resume")
        self.assertEqual(thread.data[0]["resumeId"], resume_id)

        conn_list = self.client.get(reverse("connections")).data
        self.assertEqual(conn_list[0]["lastMessage"]["text"], "Shared a resume")

    def test_a_plain_message_has_no_attachment(self):
        self.as_(self.student)
        req = ConnectionRequest.objects.create(from_user=self.student, to_user=self.mentor, request_type="connect")
        connection = Connection.objects.create(request=req, member_a=self.student, member_b=self.mentor)
        res = self.client.post(reverse("connection-messages", args=[connection.id]), {"text": "hi there"}, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["attachment"], "")
        self.assertIsNone(res.data["resumeId"])

    def test_a_message_cannot_fake_a_resume_attachment(self):
        self.as_(self.student)
        req = ConnectionRequest.objects.create(from_user=self.student, to_user=self.mentor, request_type="connect")
        connection = Connection.objects.create(request=req, member_a=self.student, member_b=self.mentor)
        res = self.client.post(
            reverse("connection-messages", args=[connection.id]),
            {"text": "hi", "attachment": "resume", "resumeId": 999},
            format="json",
        )
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["attachment"], "")  # read-only fields, silently ignored on write


@override_settings(
    ADMIN_LOGIN_MAX_FAILURES_PER_USERNAME=5,
    ADMIN_LOGIN_MAX_FAILURES_PER_IP=20,
    ADMIN_LOGIN_LOCKOUT_MINUTES=15,
    # Every attempt hashes a password; the real hasher is deliberately slow.
    PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"],
)
class AdminSecurityTests(APITestCase):
    def setUp(self):
        self.admin_user = User.objects.create_superuser("boss", "boss@example.com", "correct-horse-battery-staple")
        self.factory = RequestFactory()

    def attempt(self, password, username="boss", ip="203.0.113.7"):
        from portal.admin_security import LockoutAdminAuthenticationForm

        request = self.factory.post("/x/", HTTP_X_FORWARDED_FOR=f"10.0.0.1, {ip}")
        form = LockoutAdminAuthenticationForm(request, data={"username": username, "password": password})
        return form.is_valid(), form

    def test_correct_password_signs_in(self):
        ok, _ = self.attempt("correct-horse-battery-staple")
        self.assertTrue(ok)

    def test_locks_out_after_repeated_failures_even_with_the_right_password(self):
        for _ in range(5):
            self.assertFalse(self.attempt("wrong")[0])
        ok, form = self.attempt("correct-horse-battery-staple")
        self.assertFalse(ok)
        self.assertIn("Too many failed sign-in attempts", str(form.errors))

    def test_lockout_follows_the_username_across_ip_addresses(self):
        for i in range(5):
            self.attempt("wrong", ip=f"198.51.100.{i}")
        self.assertFalse(self.attempt("correct-horse-battery-staple", ip="192.0.2.99")[0])

    def test_one_ip_spraying_many_usernames_gets_locked_out(self):
        for i in range(20):
            self.attempt("wrong", username=f"guess{i}")
        self.assertFalse(self.attempt("correct-horse-battery-staple")[0])  # same IP
        self.assertTrue(self.attempt("correct-horse-battery-staple", ip="192.0.2.50")[0])  # elsewhere is fine

    def test_lockout_expires_on_its_own(self):
        from portal.models import AdminLoginFailure

        for _ in range(5):
            self.attempt("wrong")
        AdminLoginFailure.objects.update(failed_at=timezone.now() - timedelta(minutes=16))
        self.assertTrue(self.attempt("correct-horse-battery-staple")[0])

    def test_success_clears_the_count(self):
        from portal.models import AdminLoginFailure

        for _ in range(3):
            self.attempt("wrong")
        self.assertTrue(self.attempt("correct-horse-battery-staple")[0])
        self.assertFalse(AdminLoginFailure.objects.filter(username="boss").exists())

    def test_client_ip_uses_the_proxy_appended_address(self):
        from portal.admin_security import client_ip

        request = self.factory.get("/", HTTP_X_FORWARDED_FOR="1.2.3.4, 203.0.113.7", REMOTE_ADDR="10.0.0.2")
        self.assertEqual(client_ip(request), "203.0.113.7")
        self.assertEqual(client_ip(self.factory.get("/", REMOTE_ADDR="10.0.0.2")), "10.0.0.2")


class AdminUrlTests(SimpleTestCase):
    def _admin_resolves(self, path):
        import importlib

        from django.urls import Resolver404, clear_url_caches, resolve

        import config.urls

        importlib.reload(config.urls)
        clear_url_caches()
        try:
            with override_settings(ROOT_URLCONF="config.urls"):
                resolve(path, urlconf=config.urls)
            return True
        except Resolver404:
            return False

    def tearDown(self):
        import importlib

        from django.urls import clear_url_caches

        import config.urls

        importlib.reload(config.urls)
        clear_url_caches()

    def test_admin_is_served_only_at_the_configured_path(self):
        with override_settings(ADMIN_URL="staff-7f3k9q/"):
            self.assertTrue(self._admin_resolves("/staff-7f3k9q/"))
            self.assertFalse(self._admin_resolves("/admin/"))

    def test_admin_is_not_served_when_no_path_is_configured(self):
        with override_settings(ADMIN_URL=None):
            self.assertFalse(self._admin_resolves("/admin/"))
            self.assertTrue(self._admin_resolves("/api/health/"))  # the API is unaffected


def _docx_bytes(extra_parts=()):
    """A minimal but genuine .docx: a ZIP with the parts Word always writes."""
    import io
    import zipfile

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("[Content_Types].xml", "<Types/>")
        archive.writestr("word/document.xml", "<w:document/>")
        for name in extra_parts:
            archive.writestr(name, "x")
    return buffer.getvalue()


def _zip_bytes():
    import io
    import zipfile

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("notes.txt", "hello")
    return buffer.getvalue()


@override_settings(MEDIA_ROOT=tempfile.mkdtemp())
class ResumeFileTypeTests(APITestCase):
    """The real file type comes from the bytes, not the name or content type."""

    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)
        self.me = User.objects.create(username="clerk:sender")
        self.them = User.objects.create(username="clerk:recipient")
        req = ConnectionRequest.objects.create(from_user=self.me, to_user=self.them, request_type="connect", status="accepted")
        self.connection = Connection.objects.create(request=req, member_a=self.me, member_b=self.them)
        self.client.force_authenticate(user=self.me)

    def upload(self, content, name, content_type="application/octet-stream"):
        return self.client.post(
            reverse("connection-share-resume", args=[self.connection.id]),
            {"file": _fake_file(content, name, content_type)},
            format="multipart",
        )

    def test_a_real_pdf_and_a_real_docx_are_accepted(self):
        pdf = self.upload(b"%PDF-1.7\n...", "My CV.pdf", "application/pdf")
        self.assertEqual(pdf.status_code, 201, pdf.data)
        self.assertEqual(pdf.data["resumeFileName"], "My CV.pdf")
        self.client.force_authenticate(user=self.them)
        download = self.client.get(reverse("resume-download", args=[pdf.data["resumeId"]]))
        self.assertIn('filename="My CV.pdf"', download["Content-Disposition"])  # same name as shown in the chat
        self.client.force_authenticate(user=self.me)

        # Browsers often send .docx as application/octet-stream - still fine.
        docx = self.upload(_docx_bytes(), "cv.docx")
        self.assertEqual(docx.status_code, 201, docx.data)
        self.assertEqual(docx.data["resumeFileName"], "cv.docx")

    def test_legacy_doc_is_refused_with_a_helpful_message(self):
        res = self.upload(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"x" * 100, "resume.doc", "application/msword")
        self.assertEqual(res.status_code, 400)
        self.assertIn("save it as .docx or PDF", str(res.data))

    def test_files_pretending_to_be_a_resume_are_refused(self):
        cases = {
            "an .exe renamed to .pdf": (b"MZ\x90\x00" + b"x" * 100, "resume.pdf", "application/pdf"),
            "an HTML page renamed to .pdf": (b"<html><script>alert(1)</script>", "resume.pdf", "application/pdf"),
            "a plain .zip renamed to .docx": (_zip_bytes(), "resume.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
            "a macro .docm renamed to .docx": (_docx_bytes(["word/vbaProject.bin"]), "resume.docx", "application/octet-stream"),
            "a real PDF with the wrong extension": (b"%PDF-1.4 ...", "resume.exe", "application/pdf"),
            "no extension": (b"%PDF-1.4 ...", "resume", "application/pdf"),
        }
        for label, (content, name, content_type) in cases.items():
            with self.subTest(label):
                res = self.upload(content, name, content_type)
                self.assertEqual(res.status_code, 400, res.data)
        self.assertFalse(Resume.objects.exists())

    def test_showing_a_thread_never_reads_resume_files_from_storage(self):
        for i in range(3):
            self.assertEqual(self.upload(b"%PDF-1.4 " + b"x" * 2048, f"cv{i}.pdf", "application/pdf").status_code, 201)
        url = reverse("connection-messages", args=[self.connection.id])
        from django.db import connection as db_connection
        from django.db.models.fields.files import FieldFile
        from django.test.utils import CaptureQueriesContext

        with mock.patch.object(FieldFile, "size", new_callable=mock.PropertyMock) as size, CaptureQueriesContext(db_connection) as ctx:
            res = self.client.get(url)
        self.assertEqual(res.status_code, 200)
        size.assert_not_called()  # on R2 each of these would be a network request
        self.assertEqual(res.data[0]["resumeSizeLabel"], "2 KB")
        # The thread is a fixed number of queries however many resumes it has.
        self.assertLessEqual(len(ctx.captured_queries), 6)

    def test_stored_name_is_cleaned_and_matches_the_real_type(self):
        res = self.upload(b"%PDF-1.4 ...", "../../etc/<evil>name.PDF", "application/pdf")
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(res.data["resumeFileName"], "evilname.pdf")


class SafetyTests(APITestCase):
    """Blocking, the re-request cooldown, and one live connection per pair."""

    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)
        self.me = _discoverable(User.objects.create(username="clerk:me"))
        self.them = _discoverable(User.objects.create(username="clerk:them"))

    def as_(self, user):
        self.client.force_authenticate(user=user)

    def request_from(self, sender, receiver, **extra):
        self.as_(sender)
        return self.client.post(
            reverse("requests"), {"toId": receiver.id, "requestType": "connect", "message": "hi", **extra}, format="json"
        )

    def connect(self):
        req = ConnectionRequest.objects.create(from_user=self.me, to_user=self.them, request_type="connect", status="accepted")
        return Connection.objects.create(request=req, member_a=self.me, member_b=self.them)

    def block(self, blocker, blocked):
        self.as_(blocker)
        return self.client.post(reverse("member-block", args=[blocked.id]))

    # --- blocking ---------------------------------------------------------

    def test_blocking_works_both_ways_for_requests_and_profiles(self):
        self.assertEqual(self.block(self.me, self.them).status_code, 201)

        for sender, receiver in ((self.me, self.them), (self.them, self.me)):
            with self.subTest(sender=sender.username):
                res = self.request_from(sender, receiver)
                self.assertEqual(res.status_code, 400)
                # Same answer as a missing member: doesn't reveal the block.
                self.assertIn("isn't available", str(res.data))
                self.as_(sender)
                self.assertEqual(self.client.get(reverse("member-profile", args=[receiver.id])).status_code, 404)
                ids = [m["id"] for m in self.client.get(reverse("professionals") + "?search=Member").data["results"]]
                self.assertNotIn(receiver.id, ids)
        self.assertFalse(ConnectionRequest.objects.exists())

    def test_blocking_ends_the_connection_and_pending_requests(self):
        connection = self.connect()
        pending = ConnectionRequest.objects.create(from_user=self.them, to_user=self.me, request_type="referral")
        self.block(self.me, self.them)

        connection.refresh_from_db()
        pending.refresh_from_db()
        self.assertEqual(connection.status, "cancelled")
        self.assertEqual(pending.status, "cancelled")

        for sender in (self.me, self.them):
            with self.subTest(sender=sender.username):
                self.as_(sender)
                res = self.client.post(reverse("connection-messages", args=[connection.id]), {"text": "hello?"}, format="json")
                self.assertEqual(res.status_code, 400)
        self.assertFalse(Message.objects.exists())

    def test_a_block_stops_messages_even_if_a_connection_were_still_active(self):
        connection = self.connect()
        Block.objects.create(blocker=self.them, blocked=self.me)  # bypasses the endpoint's clean-up
        self.as_(self.me)
        res = self.client.post(reverse("connection-messages", args=[connection.id]), {"text": "hi"}, format="json")
        self.assertEqual(res.status_code, 403)

    def test_cannot_accept_a_request_from_someone_blocked(self):
        req = ConnectionRequest.objects.create(from_user=self.them, to_user=self.me, request_type="connect")
        Block.objects.create(blocker=self.me, blocked=self.them)
        self.as_(self.me)
        self.assertEqual(self.client.post(reverse("request-accept", args=[req.id])).status_code, 400)
        self.assertFalse(Connection.objects.exists())

    def test_unblocking_from_settings_restores_visibility(self):
        self.block(self.me, self.them)
        self.as_(self.me)
        listed = self.client.get(reverse("blocks")).data
        self.assertEqual([row["id"] for row in listed], [self.them.id])
        self.assertEqual(listed[0]["name"], f"Member {self.them.id}")

        self.assertEqual(self.client.delete(reverse("member-block", args=[self.them.id])).status_code, 204)
        self.assertEqual(self.client.get(reverse("blocks")).data, [])
        self.assertEqual(self.client.get(reverse("member-profile", args=[self.them.id])).status_code, 200)
        self.assertEqual(self.request_from(self.me, self.them).status_code, 201)

    def test_block_list_is_private_and_blocking_is_idempotent(self):
        self.assertEqual(self.block(self.me, self.them).status_code, 201)
        self.assertEqual(self.block(self.me, self.them).status_code, 201)
        self.assertEqual(Block.objects.count(), 1)
        self.as_(self.them)
        self.assertEqual(self.client.get(reverse("blocks")).data, [])

    def test_cannot_block_yourself(self):
        self.as_(self.me)
        self.assertEqual(self.client.post(reverse("member-block", args=[self.me.id])).status_code, 400)
        with self.assertRaises(IntegrityError), transaction.atomic():
            Block.objects.create(blocker=self.me, blocked=self.me)

    # --- re-request cooldown ----------------------------------------------

    def test_declined_member_must_wait_before_asking_again(self):
        first = self.request_from(self.me, self.them)
        self.as_(self.them)
        self.client.post(reverse("request-decline", args=[first.data["id"]]))

        again = self.request_from(self.me, self.them)
        self.assertEqual(again.status_code, 400)
        self.assertIn("declined your last request", str(again.data))

        # Once the cooldown has passed, they can ask again.
        ConnectionRequest.objects.filter(pk=first.data["id"]).update(updated_at=timezone.now() - timedelta(days=31))
        self.assertEqual(self.request_from(self.me, self.them).status_code, 201)

    def test_the_cooldown_only_applies_to_the_person_who_was_declined(self):
        first = self.request_from(self.me, self.them)
        self.as_(self.them)
        self.client.post(reverse("request-decline", args=[first.data["id"]]))
        # The member who said no can still reach out themselves.
        self.assertEqual(self.request_from(self.them, self.me).status_code, 201)

    def test_cancelling_your_own_request_has_no_cooldown(self):
        first = self.request_from(self.me, self.them)
        self.client.post(reverse("request-cancel", args=[first.data["id"]]))
        self.assertEqual(self.request_from(self.me, self.them).status_code, 201)

    # --- one live connection per pair -------------------------------------

    def test_cannot_request_someone_you_are_already_connected_with(self):
        self.connect()
        for sender, receiver in ((self.me, self.them), (self.them, self.me)):
            with self.subTest(sender=sender.username):
                res = self.request_from(sender, receiver)
                self.assertEqual(res.status_code, 400)
                self.assertIn("already connected", str(res.data))

    def test_database_refuses_a_second_live_connection_in_either_direction(self):
        self.connect()
        req = ConnectionRequest.objects.create(from_user=self.them, to_user=self.me, request_type="connect", status="accepted")
        with self.assertRaises(IntegrityError), transaction.atomic():
            Connection.objects.create(request=req, member_a=self.them, member_b=self.me)

    def test_a_cancelled_connection_doesnt_stop_reconnecting(self):
        old = self.connect()
        Connection.objects.filter(pk=old.pk).update(status="cancelled")
        req = ConnectionRequest.objects.create(from_user=self.them, to_user=self.me, request_type="connect", status="accepted")
        Connection.objects.create(request=req, member_a=self.them, member_b=self.me)  # no error
        self.assertEqual(Connection.objects.exclude(status="cancelled").count(), 1)

    def test_accepting_when_already_connected_is_a_clean_error(self):
        self.connect()
        req = ConnectionRequest.objects.create(from_user=self.them, to_user=self.me, request_type="connect")
        self.as_(self.me)
        res = self.client.post(reverse("request-accept", args=[req.id]))
        self.assertEqual(res.status_code, 400)
        req.refresh_from_db()
        self.assertEqual(req.status, "pending")  # nothing half-applied


class ReadStateTests(APITestCase):
    """Unread state lives on the server, per member per conversation."""

    def setUp(self):
        self.me = User.objects.create(username="clerk:reader")
        self.them = User.objects.create(username="clerk:writer")
        req = ConnectionRequest.objects.create(from_user=self.me, to_user=self.them, request_type="connect", status="accepted")
        self.connection = Connection.objects.create(request=req, member_a=self.me, member_b=self.them)

    def as_(self, user):
        self.client.force_authenticate(user=user)

    def send(self, sender, text="hi"):
        self.as_(sender)
        res = self.client.post(reverse("connection-messages", args=[self.connection.id]), {"text": text}, format="json")
        self.assertEqual(res.status_code, 201)
        return res

    def my_connection(self, user):
        self.as_(user)
        return next(c for c in self.client.get(reverse("connections")).data if c["id"] == self.connection.id)

    def test_new_conversation_starts_unread_for_the_recipient(self):
        self.send(self.them)
        self.assertIsNone(self.my_connection(self.me)["lastReadAt"])

    def test_opening_a_conversation_marks_it_read_and_it_stays_read(self):
        self.send(self.them)
        self.as_(self.me)
        res = self.client.post(reverse("connection-read", args=[self.connection.id]))
        self.assertEqual(res.status_code, 200)
        self.assertIsNotNone(res.data["lastReadAt"])

        # A fresh load (a reload, another device) still sees it as read.
        mine = self.my_connection(self.me)
        self.assertGreaterEqual(mine["lastReadAt"], mine["lastMessage"]["createdAt"])

    def test_read_state_is_per_member_and_private(self):
        self.send(self.them)
        self.connection.refresh_from_db()
        their_read_before = self.connection.member_b_last_read_at  # set when they sent it

        self.as_(self.me)
        self.client.post(reverse("connection-read", args=[self.connection.id]))
        self.connection.refresh_from_db()

        # My read doesn't touch theirs...
        self.assertEqual(self.connection.member_b_last_read_at, their_read_before)
        self.assertGreater(self.connection.member_a_last_read_at, their_read_before)
        # ...and each of us only ever sees our own (no read receipts).
        self.assertEqual(self.my_connection(self.them)["lastReadAt"], their_read_before)
        self.assertEqual(self.my_connection(self.me)["lastReadAt"], self.connection.member_a_last_read_at)

    def test_sending_a_message_counts_as_reading_the_conversation(self):
        self.send(self.them, "first")
        self.send(self.me, "reply")
        mine = self.my_connection(self.me)
        self.assertEqual(mine["lastReadAt"], mine["lastMessage"]["createdAt"])

    def test_a_newer_message_makes_it_unread_again(self):
        self.send(self.them, "one")
        self.as_(self.me)
        self.client.post(reverse("connection-read", args=[self.connection.id]))
        self.send(self.them, "two")
        mine = self.my_connection(self.me)
        self.assertLess(mine["lastReadAt"], mine["lastMessage"]["createdAt"])

    def test_read_marker_never_moves_backwards(self):
        later = timezone.now()
        self.assertTrue(self.connection.mark_read(self.me.id, later))
        self.assertFalse(self.connection.mark_read(self.me.id, later - timedelta(hours=1)))
        self.connection.refresh_from_db()
        self.assertEqual(self.connection.member_a_last_read_at, later)

    def test_marking_read_moves_the_sync_version_so_other_tabs_update(self):
        self.send(self.them)
        self.as_(self.me)
        before = self.client.get(reverse("sync")).data["version"]
        self.client.post(reverse("connection-read", args=[self.connection.id]))
        self.assertNotEqual(self.client.get(reverse("sync")).data["version"], before)

    def test_strangers_cannot_mark_someone_elses_conversation_read(self):
        stranger = User.objects.create(username="clerk:stranger")
        self.as_(stranger)
        self.assertEqual(self.client.post(reverse("connection-read", args=[self.connection.id])).status_code, 404)

    def test_read_time_and_message_time_render_in_the_same_format(self):
        # The frontend decides "unread" by comparing these two ISO strings.
        self.send(self.me)
        self.as_(self.me)
        body = self.client.get(reverse("connections")).json()
        mine = next(c for c in body if c["id"] == self.connection.id)
        self.assertEqual(mine["lastReadAt"], mine["lastMessage"]["createdAt"])
        self.assertIsInstance(mine["lastReadAt"], str)

    def test_a_cancelled_conversation_can_still_be_marked_read(self):
        self.send(self.them)
        Connection.objects.filter(pk=self.connection.pk).update(status="cancelled")
        self.as_(self.me)
        self.assertEqual(self.client.post(reverse("connection-read", args=[self.connection.id])).status_code, 200)


class ExtendedProfileTests(APITestCase):
    """Education / work experience / certifications - each managed through
    its own /members/me/<kind>/ endpoints, embedded read-only on the profile."""

    def setUp(self):
        self.me = User.objects.create(username="clerk:me")
        self.other = User.objects.create(username="clerk:other")
        self.client.force_authenticate(user=self.me)

    def test_add_edit_delete_education(self):
        res = self.client.post(
            reverse("education-list"),
            {"school": "UCF", "degree": "BS", "fieldOfStudy": "CS", "startYear": 2020, "endYear": 2024},
            format="json",
        )
        self.assertEqual(res.status_code, 201, res.data)
        entry_id = res.data["id"]
        self.assertEqual(Education.objects.get(pk=entry_id).profile.user, self.me)

        edit = self.client.patch(reverse("education-detail", args=[entry_id]), {"degree": "BS Honors"}, format="json")
        self.assertEqual(edit.status_code, 200)
        self.assertEqual(edit.data["degree"], "BS Honors")

        listed = self.client.get(reverse("education-list"))
        self.assertEqual(len(listed.data), 1)

        deleted = self.client.delete(reverse("education-detail", args=[entry_id]))
        self.assertEqual(deleted.status_code, 204)
        self.assertEqual(Education.objects.filter(pk=entry_id).count(), 0)

    def test_add_edit_delete_experience(self):
        res = self.client.post(
            reverse("experience-list"),
            {"jobTitle": "SWE Intern", "company": "Acme", "startDate": "2023-06-01", "currentlyWorking": False, "endDate": "2023-08-30"},
            format="json",
        )
        self.assertEqual(res.status_code, 201, res.data)
        entry_id = res.data["id"]

        edit = self.client.patch(reverse("experience-detail", args=[entry_id]), {"currentlyWorking": True, "endDate": None}, format="json")
        self.assertEqual(edit.status_code, 200)
        self.assertTrue(edit.data["currentlyWorking"])

        deleted = self.client.delete(reverse("experience-detail", args=[entry_id]))
        self.assertEqual(deleted.status_code, 204)

    def test_add_edit_delete_certification(self):
        res = self.client.post(
            reverse("certifications-list"),
            {"name": "AWS Certified", "issuingOrganization": "Amazon", "issueDate": "2024-01-15"},
            format="json",
        )
        self.assertEqual(res.status_code, 201, res.data)
        entry_id = res.data["id"]

        edit = self.client.patch(reverse("certifications-detail", args=[entry_id]), {"credentialUrl": "https://example.com/cred"}, format="json")
        self.assertEqual(edit.status_code, 200)
        self.assertEqual(edit.data["credentialUrl"], "https://example.com/cred")

        deleted = self.client.delete(reverse("certifications-detail", args=[entry_id]))
        self.assertEqual(deleted.status_code, 204)

    def test_cannot_touch_someone_elses_entries(self):
        other_profile = Profile.objects.create(user=self.other)
        education = Education.objects.create(profile=other_profile, school="MIT")
        experience = WorkExperience.objects.create(profile=other_profile, job_title="PM", company="Acme")
        certification = Certification.objects.create(profile=other_profile, name="PMP")

        self.assertEqual(self.client.patch(reverse("education-detail", args=[education.id]), {"school": "x"}, format="json").status_code, 404)
        self.assertEqual(self.client.delete(reverse("experience-detail", args=[experience.id])).status_code, 404)
        self.assertEqual(self.client.get(reverse("certifications-detail", args=[certification.id])).status_code, 404)

    def test_entries_are_embedded_read_only_on_the_profile(self):
        Education.objects.create(profile=Profile.objects.create(user=self.me), school="UCF")
        res = self.client.get(reverse("my-profile"))
        self.assertEqual(res.data["education"][0]["school"], "UCF")

        # sending them in a profile PATCH is silently ignored - not writable here
        patched = self.client.patch(reverse("my-profile"), {"education": []}, format="json")
        self.assertEqual(patched.status_code, 200)
        self.assertEqual(len(patched.data["education"]), 1)


def _discoverable(user, **fields):
    """Marks a user as a finished, visible member - the only kind of person a
    connection request can be sent to - without going through the full
    photo-and-bio onboarding flow (complete_profile does that when it matters)."""
    Profile.objects.update_or_create(user=user, defaults={"name": f"Member {user.id}", "onboarding_complete": True, **fields})
    return user


def _fake_file(content, name, content_type):
    from django.core.files.uploadedfile import SimpleUploadedFile

    return SimpleUploadedFile(name, content, content_type=content_type)


def _fake_image(mb=None):
    import io

    from PIL import Image

    buffer = io.BytesIO()
    Image.new("RGB", (10, 10), color="green").save(buffer, format="PNG")
    content = buffer.getvalue()
    if mb:
        content += b"\0" * (mb * 1024 * 1024)
    return _fake_file(content, "photo.png", "image/png")


@override_settings(MEDIA_ROOT=tempfile.mkdtemp())
class UploadCleanupTests(APITestCase):
    """Files must not outlive the database rows that point at them."""

    def setUp(self):
        self.user = User.objects.create(username="clerk:cleanup")
        self.other = User.objects.create(username="clerk:cleanup-other")
        req = ConnectionRequest.objects.create(from_user=self.user, to_user=self.other, request_type="connect")
        self.connection = Connection.objects.create(request=req, member_a=self.user, member_b=self.other)
        self.client.force_authenticate(user=self.user)

    def resume_named(self, name):
        from django.core.files.uploadedfile import SimpleUploadedFile

        return SimpleUploadedFile(name, b"%PDF-1.4 resume", content_type="application/pdf")

    def upload_resume(self, name="cv.pdf"):
        with self.captureOnCommitCallbacks(execute=True):
            res = self.client.post(
                reverse("connection-share-resume", args=[self.connection.id]), {"file": self.resume_named(name)}, format="multipart"
            )
        self.assertEqual(res.status_code, 201)
        return Resume.objects.get(pk=res.data["resumeId"])

    def test_deleting_a_resume_deletes_its_file(self):
        resume = self.upload_resume()
        name, storage = resume.file.name, resume.file.storage
        with self.captureOnCommitCallbacks(execute=True):
            resume.delete()
        self.assertFalse(storage.exists(name))

    def test_replacing_and_removing_a_photo_deletes_the_file(self):
        with self.captureOnCommitCallbacks(execute=True):
            self.client.post(reverse("upload-avatar"), {"file": _fake_image()}, format="multipart")
        profile = Profile.objects.get(user=self.user)
        first, storage = profile.avatar.name, profile.avatar.storage
        self.assertTrue(storage.exists(first))

        with self.captureOnCommitCallbacks(execute=True):
            self.client.post(reverse("upload-avatar"), {"file": _fake_image()}, format="multipart")
        profile.refresh_from_db()
        second = profile.avatar.name
        self.assertNotEqual(first, second)
        self.assertFalse(storage.exists(first))
        self.assertTrue(storage.exists(second))

        with self.captureOnCommitCallbacks(execute=True):
            self.client.delete(reverse("upload-avatar"))
        self.assertFalse(storage.exists(second))

    def test_replacing_a_photo_three_times_never_reuses_a_url(self):
        # Regression: each upload used to be named the fixed "avatar.webp",
        # so once the first upload's file was cleaned up after the second
        # replaced it, a third upload could collide back onto the first
        # upload's exact URL - which browsers had already cached forever
        # (avatars are served with an immutable, 1-year cache header), so the
        # photo looked like it silently failed to update.
        names = []
        for _ in range(3):
            with self.captureOnCommitCallbacks(execute=True):
                self.client.post(reverse("upload-avatar"), {"file": _fake_image()}, format="multipart")
            names.append(Profile.objects.get(user=self.user).avatar.name)
        self.assertEqual(len(set(names)), 3, names)

    def test_deleting_a_user_deletes_their_files(self):
        resume = self.upload_resume()
        with self.captureOnCommitCallbacks(execute=True):
            self.client.post(reverse("upload-avatar"), {"file": _fake_image()}, format="multipart")
        storage = resume.file.storage
        resume_name = resume.file.name
        avatar_name = Profile.objects.get(user=self.user).avatar.name
        self.assertTrue(storage.exists(resume_name) and storage.exists(avatar_name))

        with self.captureOnCommitCallbacks(execute=True):
            self.user.delete()
        self.assertFalse(storage.exists(resume_name))
        self.assertFalse(storage.exists(avatar_name))

    def test_a_rolled_back_change_keeps_the_file(self):
        from django.db import transaction

        resume = self.upload_resume()
        name, storage = resume.file.name, resume.file.storage
        with self.captureOnCommitCallbacks(execute=True):
            try:
                with transaction.atomic():
                    Resume.objects.get(pk=resume.pk).delete()
                    raise RuntimeError("boom")
            except RuntimeError:
                pass
        self.assertTrue(storage.exists(name))


class RateLimitTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)
        tight = {**api_settings.DEFAULT_THROTTLE_RATES, "requests": "2/day", "messages": "2/min"}
        patcher = mock.patch.object(SimpleRateThrottle, "THROTTLE_RATES", tight)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.user = User.objects.create(username="clerk:limited")
        self.client.force_authenticate(user=self.user)

    def test_sending_requests_is_limited_but_reading_them_is_not(self):
        targets = [_discoverable(User.objects.create(username=f"clerk:target{i}")) for i in range(3)]

        def send(target):
            return self.client.post(
                reverse("requests"), {"toId": target.id, "requestType": "connect", "message": "hi"}, format="json"
            )

        self.assertEqual(send(targets[0]).status_code, 201)
        self.assertEqual(send(targets[1]).status_code, 201)
        self.assertEqual(send(targets[2]).status_code, 429)
        for _ in range(10):
            self.assertEqual(self.client.get(reverse("requests")).status_code, 200)

    def test_sending_messages_is_limited_but_the_refresh_is_not(self):
        other = User.objects.create(username="clerk:friend")
        req = ConnectionRequest.objects.create(from_user=self.user, to_user=other, request_type="connect")
        connection = Connection.objects.create(request=req, member_a=self.user, member_b=other)
        url = reverse("connection-messages", args=[connection.id])

        self.assertEqual(self.client.post(url, {"text": "one"}, format="json").status_code, 201)
        self.assertEqual(self.client.post(url, {"text": "two"}, format="json").status_code, 201)
        self.assertEqual(self.client.post(url, {"text": "three"}, format="json").status_code, 429)
        for _ in range(10):
            self.assertEqual(self.client.get(url).status_code, 200)

    def test_one_users_limit_does_not_affect_another(self):
        first, second = (_discoverable(User.objects.create(username=f"clerk:{key}")) for key in ("t1", "t2"))
        body = {"toId": first.id, "requestType": "connect", "message": "hi"}
        self.client.post(reverse("requests"), body, format="json")
        self.client.post(reverse("requests"), {**body, "toId": second.id}, format="json")
        self.assertEqual(self.client.post(reverse("requests"), body, format="json").status_code, 429)

        someone_else = User.objects.create(username="clerk:someone-else")
        self.client.force_authenticate(user=someone_else)
        res = self.client.post(reverse("requests"), body, format="json")
        self.assertNotEqual(res.status_code, 429)


@override_settings(NOTIFICATIONS_ENABLED=True, NOTIFICATIONS_ASYNC=False, PORTAL_BASE_URL="https://portal.example.org")
class NotificationTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)
        patcher = mock.patch("portal.notifications._clerk_email", side_effect=lambda clerk_id: f"{clerk_id}@example.com")
        self.clerk_email = patcher.start()
        self.addCleanup(patcher.stop)
        self.sender = self.member("sender", "Sam Sender")
        self.recipient = self.member("recipient", "Rita Recipient")

    def member(self, key, name):
        user = User.objects.create(username=f"clerk:{key}")
        ClerkIdentity.objects.create(clerk_id=key, user=user)
        Profile.objects.create(user=user, name=name, onboarding_complete=True)
        return user

    def send_request(self, message="secret details"):
        self.client.force_authenticate(user=self.sender)
        with self.captureOnCommitCallbacks(execute=True):
            return self.client.post(
                reverse("requests"), {"toId": self.recipient.id, "requestType": "connect", "message": message}, format="json"
            )

    def connect(self):
        req = ConnectionRequest.objects.create(from_user=self.sender, to_user=self.recipient, request_type="connect", status="accepted")
        return Connection.objects.create(request=req, member_a=self.sender, member_b=self.recipient)

    def test_a_new_request_emails_the_recipient_without_leaking_the_message(self):
        self.assertEqual(self.send_request("my private pitch").status_code, 201)
        self.assertEqual(len(mail.outbox), 1)
        email = mail.outbox[0]
        self.assertEqual(email.to, ["recipient@example.com"])
        self.assertIn("Sam Sender", email.subject)
        self.assertIn("https://portal.example.org/portal/requests", email.body)
        self.assertNotIn("my private pitch", email.subject + email.body)

    def test_members_can_opt_out(self):
        Profile.objects.filter(user=self.recipient).update(email_notifications=False)
        self.send_request()
        self.assertEqual(mail.outbox, [])

    def test_accepting_emails_the_requester(self):
        self.send_request()
        mail.outbox.clear()
        req = ConnectionRequest.objects.get()
        self.client.force_authenticate(user=self.recipient)
        with self.captureOnCommitCallbacks(execute=True):
            res = self.client.post(reverse("request-accept", args=[req.id]))
        self.assertEqual(res.status_code, 201)
        self.assertEqual([m.to for m in mail.outbox], [["sender@example.com"]])
        self.assertIn("accepted", mail.outbox[0].subject)

    def test_a_burst_of_messages_sends_one_email(self):
        connection = self.connect()
        url = reverse("connection-messages", args=[connection.id])
        self.client.force_authenticate(user=self.sender)
        for text in ("one", "two", "three"):
            with self.captureOnCommitCallbacks(execute=True):
                self.assertEqual(self.client.post(url, {"text": text}, format="json").status_code, 201)
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ["recipient@example.com"])
        self.assertNotIn("one", mail.outbox[0].body.replace("Open it here", ""))

    def test_a_mail_failure_never_breaks_the_request(self):
        with mock.patch("portal.notifications.send_mail", side_effect=RuntimeError("smtp is down")):
            res = self.send_request()
        self.assertEqual(res.status_code, 201)
        self.assertEqual(ConnectionRequest.objects.count(), 1)

    def test_a_multiline_name_cannot_inject_email_headers(self):
        Profile.objects.filter(user=self.sender).update(name="Sam" + chr(10) + "Bcc: attacker@example.com")
        self.send_request()
        self.assertEqual(len(mail.outbox), 1)
        self.assertNotIn(chr(10), mail.outbox[0].subject)
        self.assertEqual(mail.outbox[0].bcc, [])

    @override_settings(NOTIFICATIONS_ENABLED=False)
    def test_nothing_is_sent_or_looked_up_when_disabled(self):
        self.send_request()
        self.assertEqual(mail.outbox, [])
        self.clerk_email.assert_not_called()

    def test_the_preference_is_private_to_its_owner(self):
        self.client.force_authenticate(user=self.sender)
        own = self.client.get(reverse("my-profile"))
        self.assertIs(own.data["emailNotifications"], True)
        others = self.client.get(reverse("member-profile", args=[self.recipient.id]))
        self.assertNotIn("emailNotifications", others.data)

        res = self.client.patch(reverse("my-profile"), {"emailNotifications": False}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertIs(res.data["emailNotifications"], False)
        self.assertFalse(Profile.objects.get(user=self.sender).email_notifications)


@override_settings(MEDIA_ROOT=tempfile.mkdtemp())
class ScalingTests(APITestCase):
    """The guarantees that keep the portal fast with many members."""

    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)
        self.me = User.objects.create(username="clerk:me")
        self.friend = User.objects.create(username="clerk:friend")
        self.client.force_authenticate(user=self.me)

    def connect(self, other=None):
        other = other or self.friend
        req = ConnectionRequest.objects.create(from_user=self.me, to_user=other, request_type="connect", status="accepted")
        return Connection.objects.create(request=req, member_a=self.me, member_b=other)

    def image_upload(self, size, mode="RGB", name="photo.png", content_type="image/png"):
        import io

        from django.core.files.uploadedfile import SimpleUploadedFile
        from PIL import Image

        buffer = io.BytesIO()
        Image.new(mode, size, "green" if mode == "RGB" else 128).save(buffer, "PNG")
        return SimpleUploadedFile(name, buffer.getvalue(), content_type=content_type)

    def test_discover_is_a_fixed_number_of_queries_however_full_the_profiles_are(self):
        others = [User.objects.create(username=f"clerk:p{i}") for i in range(20)]
        for u in others:
            profile = _discoverable(u)
            profile = Profile.objects.get(user=u)
            for _ in range(2):
                Education.objects.create(profile=profile, school="UIC")
                WorkExperience.objects.create(profile=profile, job_title="Engineer", company="Acme")
                Certification.objects.create(profile=profile, name="AWS")
        # count + page + blocks + connections + 3 prefetches; was 63 before.
        with self.assertNumQueries(7):
            res = self.client.get(reverse("professionals"))
        self.assertEqual(len(res.data["results"]), 20)
        self.assertEqual(len(res.data["results"][0]["education"]), 2)

    # --- the cheap "has anything changed?" check -----------------------------

    def test_sync_is_two_queries_however_much_data_there_is(self):
        connection = self.connect()
        Message.objects.bulk_create([Message(connection=connection, sender=self.me, text=f"m{i}") for i in range(50)])
        with self.assertNumQueries(2):
            res = self.client.get(reverse("sync"))
        self.assertEqual(res.status_code, 200)

    def test_sync_version_moves_when_something_changes(self):
        empty = self.client.get(reverse("sync")).data["version"]
        self.assertEqual(empty, "0")

        _discoverable(self.me)
        self.client.force_authenticate(user=self.friend)
        self.client.post(reverse("requests"), {"toId": self.me.id, "requestType": "connect", "message": "hi"}, format="json")
        self.client.force_authenticate(user=self.me)
        after_request = self.client.get(reverse("sync")).data["version"]
        self.assertNotEqual(after_request, empty)

        request_id = ConnectionRequest.objects.get().id
        self.client.post(reverse("request-accept", args=[request_id]))
        after_accept = self.client.get(reverse("sync")).data["version"]
        self.assertNotEqual(after_accept, after_request)

        connection = Connection.objects.get()
        self.client.post(reverse("connection-messages", args=[connection.id]), {"text": "hello"}, format="json")
        after_message = self.client.get(reverse("sync")).data["version"]
        self.assertNotEqual(after_message, after_accept)

        # nothing changed since: same version, so the portal downloads nothing
        self.assertEqual(self.client.get(reverse("sync")).data["version"], after_message)

    def test_sync_ignores_other_peoples_activity(self):
        a, b = User.objects.create(username="clerk:a"), User.objects.create(username="clerk:b")
        before = self.client.get(reverse("sync")).data["version"]
        req = ConnectionRequest.objects.create(from_user=a, to_user=b, request_type="connect")
        Connection.objects.create(request=req, member_a=a, member_b=b)
        self.assertEqual(self.client.get(reverse("sync")).data["version"], before)

    def test_sync_requires_a_signed_in_member(self):
        self.client.force_authenticate(user=None)
        self.assertIn(self.client.get(reverse("sync")).status_code, (401, 403))

    # --- conversation previews and bounded threads -----------------------------

    def test_connection_list_carries_the_latest_message_preview(self):
        connection = self.connect()
        first = self.client.get(reverse("connections")).data[0]
        self.assertIsNone(first["lastMessage"])

        self.client.post(reverse("connection-messages", args=[connection.id]), {"text": "x" * 300}, format="json")
        preview = self.client.get(reverse("connections")).data[0]["lastMessage"]
        self.assertEqual(preview["senderId"], self.me.id)
        self.assertEqual(len(preview["text"]), 140)

    def test_connection_list_needs_no_query_per_connection(self):
        for i in range(10):
            self.connect(User.objects.create(username=f"clerk:c{i}"))
        with self.assertNumQueries(1):
            res = self.client.get(reverse("connections"))
        self.assertEqual(len(res.data), 10)

    def test_a_long_conversation_returns_only_the_latest_messages(self):
        connection = self.connect()
        Message.objects.bulk_create([Message(connection=connection, sender=self.me, text=f"m{i}") for i in range(250)])
        res = self.client.get(reverse("connection-messages", args=[connection.id]))
        self.assertEqual(len(res.data), 200)
        self.assertEqual(res.data[0]["text"], "m50")
        self.assertEqual(res.data[-1]["text"], "m249")

    # --- profile photos --------------------------------------------------------

    def test_photos_are_shrunk_to_a_small_webp(self):
        res = self.client.post(reverse("upload-avatar"), {"file": self.image_upload((1600, 900))}, format="multipart")
        self.assertEqual(res.status_code, 201)

        from PIL import Image

        profile = Profile.objects.get(user=self.me)
        self.assertTrue(profile.avatar.name.endswith(".webp"))
        with profile.avatar.open("rb") as stored:
            image = Image.open(stored)
            self.assertEqual(image.format, "WEBP")
            self.assertLessEqual(max(image.size), 256)
            self.assertAlmostEqual(image.size[0] / image.size[1], 1600 / 900, places=1)
        self.assertLess(profile.avatar.size, 20_000)

    def test_a_file_that_is_not_really_an_image_is_refused(self):
        from django.core.files.uploadedfile import SimpleUploadedFile

        fake = SimpleUploadedFile("photo.png", b"this is not an image at all", content_type="image/png")
        res = self.client.post(reverse("upload-avatar"), {"file": fake}, format="multipart")
        self.assertEqual(res.status_code, 400)
        self.assertFalse(Profile.objects.filter(user=self.me).exclude(avatar="").exists())

    def test_absurdly_large_dimensions_are_refused(self):
        res = self.client.post(reverse("upload-avatar"), {"file": self.image_upload((14000, 11000), mode="L")}, format="multipart")
        self.assertEqual(res.status_code, 400)

    def test_a_photo_just_over_the_pixel_cap_is_refused(self):
        res = self.client.post(reverse("upload-avatar"), {"file": self.image_upload((8000, 6300), mode="L")}, format="multipart")
        self.assertEqual(res.status_code, 400)

    def test_formats_outside_jpeg_png_webp_are_refused_whatever_the_browser_claims(self):
        import io

        from django.core.files.uploadedfile import SimpleUploadedFile
        from PIL import Image

        for fmt in ("TIFF", "BMP", "GIF"):
            with self.subTest(fmt=fmt):
                buffer = io.BytesIO()
                Image.new("RGB", (64, 64), "green").save(buffer, fmt)
                upload = SimpleUploadedFile("photo.png", buffer.getvalue(), content_type="image/png")
                res = self.client.post(reverse("upload-avatar"), {"file": upload}, format="multipart")
                self.assertEqual(res.status_code, 400)

    def test_a_big_jpeg_still_becomes_a_small_avatar(self):
        import io

        from django.core.files.uploadedfile import SimpleUploadedFile
        from PIL import Image

        buffer = io.BytesIO()
        Image.new("RGB", (4000, 3000), "green").save(buffer, "JPEG")
        upload = SimpleUploadedFile("photo.jpg", buffer.getvalue(), content_type="image/jpeg")
        res = self.client.post(reverse("upload-avatar"), {"file": upload}, format="multipart")
        self.assertEqual(res.status_code, 201)
        with Profile.objects.get(user=self.me).avatar.open("rb") as f:
            self.assertLessEqual(max(Image.open(f).size), 256)

    def test_a_large_but_real_camera_photo_is_accepted(self):
        # A 48MP phone photo - well under the decompression-bomb threshold,
        # should never be rejected just for having a lot of pixels.
        res = self.client.post(reverse("upload-avatar"), {"file": self.image_upload((8064, 6048))}, format="multipart")
        self.assertEqual(res.status_code, 201)


R2_TEST_SETTINGS = dict(
    R2_ENABLED=True,
    R2_ACCOUNT_ID="acct",
    R2_ACCESS_KEY_ID="key",
    R2_SECRET_ACCESS_KEY="secret",
    R2_PRIVATE_BUCKET="private-bkt",
    R2_PUBLIC_BUCKET="public-bkt",
    R2_PUBLIC_BASE_URL="https://photos.example.org",
)


class StorageSelectionTests(SimpleTestCase):
    @override_settings(**R2_TEST_SETTINGS)
    def test_photos_use_the_public_bucket_with_plain_urls(self):
        storage = avatar_storage()
        self.assertEqual(storage.bucket_name, "public-bkt")
        self.assertEqual(storage.url("avatars/1/me.png"), "https://photos.example.org/avatars/1/me.png")
        self.assertIn("immutable", storage.object_parameters["CacheControl"])

    @override_settings(**R2_TEST_SETTINGS)
    def test_resumes_use_the_private_bucket_with_signed_urls(self):
        storage = resume_storage()
        self.assertEqual(storage.bucket_name, "private-bkt")
        url = storage.url("resumes/1/cv.pdf")
        self.assertIn("acct.r2.cloudflarestorage.com", url)
        self.assertIn("X-Amz-Signature", url)

    @override_settings(R2_ENABLED=False)
    def test_falls_back_to_local_disk_when_r2_is_not_configured(self):
        self.assertIsInstance(avatar_storage(), FileSystemStorage)
        self.assertIsInstance(resume_storage(), FileSystemStorage)
