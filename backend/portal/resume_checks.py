"""Works out what a resume upload really is, from its contents.

The browser's content type and the filename are both just whatever the
uploader's computer said, so neither can be trusted on its own: a file named
"resume.pdf" could be anything. A resume is accepted only when its extension
AND its actual bytes agree that it's a PDF or a Word .docx.

Legacy .doc files are refused - they're an old binary format that can carry
macros, and every version of Word can save as .docx or PDF instead.
"""
import os
import re
import zipfile

from rest_framework.exceptions import ValidationError

PDF = "pdf"
DOCX = "docx"

UNSUPPORTED_MESSAGE = "Resumes must be a PDF or a Word document (.docx)."
LEGACY_DOC_MESSAGE = "Old Word .doc files aren't supported. Open it in Word and save it as .docx or PDF, then try again."
MISMATCH_MESSAGE = "That file isn't really a {kind}, even though it's named like one. Please upload the original PDF or .docx."


def _extension(name):
    return os.path.splitext(name or "")[1].lower().lstrip(".")


def _looks_like_pdf(file):
    file.seek(0)
    # The PDF header must sit in the first 1 KB (most files start with it).
    head = file.read(1024)
    file.seek(0)
    return b"%PDF-" in head


def _looks_like_docx(file):
    file.seek(0)
    if file.read(4) != b"PK\x03\x04":  # every .docx is a ZIP archive
        file.seek(0)
        return False
    file.seek(0)
    try:
        # Only reads the archive's table of contents, not the contents.
        with zipfile.ZipFile(file) as archive:
            names = set(archive.namelist())
    except (zipfile.BadZipFile, OSError, ValueError):
        return False
    finally:
        file.seek(0)
    # A real Word document has this part; a renamed .zip or .xlsx doesn't.
    # vbaProject.bin means macros, i.e. a .docm renamed to .docx.
    return "word/document.xml" in names and "[Content_Types].xml" in names and "word/vbaProject.bin" not in names


def resume_kind(file):
    """Returns "pdf" or "docx", or raises ValidationError with a message the
    member can act on."""
    ext = _extension(file.name)
    if ext == "doc":
        raise ValidationError(LEGACY_DOC_MESSAGE)
    if ext == PDF:
        if not _looks_like_pdf(file):
            raise ValidationError(MISMATCH_MESSAGE.format(kind="PDF"))
        return PDF
    if ext == DOCX:
        if not _looks_like_docx(file):
            raise ValidationError(MISMATCH_MESSAGE.format(kind="Word document"))
        return DOCX
    raise ValidationError(UNSUPPORTED_MESSAGE)


def safe_resume_name(original_name, kind):
    """The name the recipient sees when they download it: the uploader's own
    file name, cleaned up, always ending in the extension that matches what
    the file actually is."""
    stem = os.path.splitext(os.path.basename(original_name or ""))[0]
    stem = re.sub(r"[^A-Za-z0-9 ._()-]+", "", stem).strip(" .") or "resume"
    return f"{stem[:80]}.{kind}"
