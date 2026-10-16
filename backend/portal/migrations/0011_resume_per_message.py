import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('portal', '0010_message_resume_attachments'),
    ]

    operations = [
        migrations.RemoveField(
            model_name='resume',
            name='shared_with',
        ),
        migrations.RenameField(
            model_name='resume',
            old_name='user',
            new_name='sender',
        ),
        migrations.AlterField(
            model_name='resume',
            name='sender',
            field=models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='shared_resumes', to=settings.AUTH_USER_MODEL),
        ),
    ]
