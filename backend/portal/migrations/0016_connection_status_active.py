from django.db import migrations, models


def completed_to_active(apps, schema_editor):
    # Accepting a request used to create connections as "completed" even
    # though nothing had finished - they were live connections all along.
    Connection = apps.get_model("portal", "Connection")
    Connection.objects.filter(status="completed").update(status="active")


class Migration(migrations.Migration):

    dependencies = [
        ("portal", "0015_profile_hidden"),
    ]

    operations = [
        # Nothing to undo: "completed" never meant anything different from
        # "active", so reversing just leaves the rows active.
        migrations.RunPython(completed_to_active, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="connection",
            name="status",
            field=models.CharField(choices=[("active", "Active"), ("cancelled", "Cancelled")], default="active", max_length=20),
        ),
    ]
