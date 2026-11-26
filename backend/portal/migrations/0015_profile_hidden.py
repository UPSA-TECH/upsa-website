from django.db import migrations, models


def move_self_deactivations_to_hidden(apps, schema_editor):
    # Until now members could only ever have set deactivated themselves (from
    # Settings), so every existing deactivated profile is a self-deactivation,
    # not an admin suspension - it belongs in the new member-controlled flag.
    Profile = apps.get_model("portal", "Profile")
    Profile.objects.filter(deactivated=True).update(hidden=True, deactivated=False)


def move_hidden_back_to_deactivated(apps, schema_editor):
    Profile = apps.get_model("portal", "Profile")
    Profile.objects.filter(hidden=True).update(deactivated=True, hidden=False)


class Migration(migrations.Migration):

    dependencies = [
        ("portal", "0014_bugreport"),
    ]

    operations = [
        migrations.AddField(
            model_name="profile",
            name="hidden",
            field=models.BooleanField(default=False),
        ),
        migrations.RunPython(move_self_deactivations_to_hidden, move_hidden_back_to_deactivated),
    ]
