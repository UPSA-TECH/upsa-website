'use client';

import { useRef, useState } from 'react';
import { PLACEHOLDER_NAME, usePortalData } from '../../_lib/PortalDataProvider';
import { ApiError } from '../../_lib/api';
import Avatar from '../../_components/Avatar';
import RoleTag from '../../_components/RoleTag';
import { useToast } from '../../_components/Toast';
import { Pencil, Camera, FileText, Download, Upload, Trash2, UploadCloud } from 'lucide-react';

export default function ProfilePage() {
  const { currentUser, state, updateProfile, uploadResume, deleteResume, downloadResume, uploadAvatar, removeAvatar } = usePortalData();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(currentUser.name === PLACEHOLDER_NAME ? '' : currentUser.name);
  const [headline, setHeadline] = useState(currentUser.headline);
  const [university, setUniversity] = useState(currentUser.university);
  const [major, setMajor] = useState(currentUser.major ?? '');
  const [bio, setBio] = useState(currentUser.bio);
  const [skillsText, setSkillsText] = useState(currentUser.skills.join(', '));
  const [company, setCompany] = useState(currentUser.company ?? '');
  const [role, setRole] = useState(currentUser.role ?? '');
  const [industry, setIndustry] = useState(currentUser.industry ?? '');
  const [location, setLocation] = useState(currentUser.location ?? '');
  const [listingBusy, setListingBusy] = useState(false);

  const hasProfessionalDetails = company.trim() && role.trim();

  async function save() {
    try {
      await updateProfile({
        name,
        headline,
        university,
        major,
        bio,
        skills: skillsText.split(',').map(s => s.trim()).filter(Boolean),
        company,
        role,
        industry,
        location,
      });
      toast('Profile saved.', 'success');
      setEditing(false);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not save your profile. Try again.', 'error');
    }
  }

  async function listMe() {
    setListingBusy(true);
    try {
      await updateProfile({ company, role, industry, location, isProfessional: true });
      toast("You're now listed in Discover.", 'success');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not list you. Try again.', 'error');
    } finally {
      setListingBusy(false);
    }
  }

  async function unlistMe() {
    setListingBusy(true);
    try {
      await updateProfile({ isProfessional: false });
      toast('Removed from Discover.', 'success');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not update that. Try again.', 'error');
    } finally {
      setListingBusy(false);
    }
  }

  async function handlePhotoPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      toast('Please upload a JPG, PNG, or WEBP image.', 'error');
      e.target.value = '';
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast('Profile photos are limited to 5 MB.', 'error');
      e.target.value = '';
      return;
    }
    setPhotoBusy(true);
    try {
      await uploadAvatar(file);
      toast('Photo updated.', 'success');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not upload that photo. Try again.', 'error');
    } finally {
      setPhotoBusy(false);
      e.target.value = '';
    }
  }

  async function handlePhotoRemove() {
    setPhotoBusy(true);
    try {
      await removeAvatar();
      toast('Photo removed.', 'success');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not remove your photo. Try again.', 'error');
    } finally {
      setPhotoBusy(false);
    }
  }

  async function handleFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const okType = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'].includes(file.type);
    if (!okType) {
      toast('Please upload a PDF, DOC, or DOCX file.', 'error');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast('Resume files are limited to 5 MB.', 'error');
      return;
    }
    setUploading(true);
    try {
      await uploadResume(file);
      toast('Resume uploaded.', 'success');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not upload that file. Try again.', 'error');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  async function handleDelete() {
    try {
      await deleteResume();
      toast('Resume deleted.', 'success');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not delete your resume. Try again.', 'error');
    }
  }

  async function handleDownload() {
    try {
      await downloadResume();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not download your resume. Try again.', 'error');
    }
  }

  return (
    <>
      <div className="profile-head">
        <Avatar
          name={currentUser.name}
          initials={currentUser.initials}
          color={currentUser.avatarColor}
          imageUrl={currentUser.avatarUrl}
          size="lg"
          verified={currentUser.isProfessional}
        />
        <div>
          <div style={{ marginBottom: 8 }}><RoleTag isProfessional={currentUser.isProfessional} /></div>
          <h1>{currentUser.name}</h1>
          <div className="sub">{currentUser.headline}</div>
          <p className="profile-head-note">This is what other members see when they view your profile.</p>
        </div>
        {!editing && (
          <button className="btn-outline btn-sm profile-head-edit" onClick={() => setEditing(true)}>
            <Pencil size={15} /> Edit profile
          </button>
        )}
      </div>

      {editing ? (
        <div className="detail-card">
          <h3>Edit details</h3>
          <div className="field">
            <label>Profile photo</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
              <div className="avatar-edit-wrap">
                <Avatar name={currentUser.name} initials={currentUser.initials} color={currentUser.avatarColor} imageUrl={currentUser.avatarUrl} size="lg" />
                <button type="button" className="avatar-edit-btn" onClick={() => photoInputRef.current?.click()} disabled={photoBusy} aria-label="Change profile photo">
                  <Camera size={16} />
                </button>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" className="btn-outline btn-sm" onClick={() => photoInputRef.current?.click()} disabled={photoBusy}>
                  {photoBusy ? 'Working…' : currentUser.hasAvatar ? 'Replace photo' : 'Upload photo'}
                </button>
                {currentUser.hasAvatar && (
                  <button type="button" className="btn-ghost" onClick={handlePhotoRemove} disabled={photoBusy}>Remove photo</button>
                )}
              </div>
              <input ref={photoInputRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={handlePhotoPick} />
            </div>
            <span className="hint">JPG, PNG, or WEBP, up to 5 MB. Photo changes save right away, no need to click Save changes.</span>
          </div>
          <div className="field">
            <label htmlFor="p-name">Full name</label>
            <input id="p-name" value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="p-headline">Title</label>
            <input
              id="p-headline"
              value={headline}
              onChange={e => setHeadline(e.target.value)}
              placeholder="e.g. CS Junior @ UCF, or Software Engineer @ Microsoft"
            />
          </div>
          <div className="field-row">
            <div className="field">
              <label htmlFor="p-university">University / company</label>
              <input id="p-university" value={university} onChange={e => setUniversity(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="p-major">Major / role</label>
              <input id="p-major" value={major} onChange={e => setMajor(e.target.value)} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="p-bio">About</label>
            <textarea id="p-bio" value={bio} onChange={e => setBio(e.target.value)} rows={4} />
          </div>
          <div className="field">
            <label htmlFor="p-skills">Skills &amp; interests (comma separated)</label>
            <input id="p-skills" value={skillsText} onChange={e => setSkillsText(e.target.value)} />
          </div>

          <h3 style={{ marginTop: 22 }}>Professional details</h3>
          <p className="hint" style={{ marginBottom: 14 }}>
            Fill these in to list yourself as a mentor/professional in Discover. You&apos;re listed immediately, no review wait.
          </p>
          <div className="field-row">
            <div className="field">
              <label htmlFor="p-company">Company</label>
              <input id="p-company" value={company} onChange={e => setCompany(e.target.value)} placeholder="e.g. Microsoft" />
            </div>
            <div className="field">
              <label htmlFor="p-role">Job title</label>
              <input id="p-role" value={role} onChange={e => setRole(e.target.value)} placeholder="e.g. Software Engineer" />
            </div>
          </div>
          <div className="field-row">
            <div className="field">
              <label htmlFor="p-industry">Industry</label>
              <input id="p-industry" value={industry} onChange={e => setIndustry(e.target.value)} placeholder="e.g. Technology" />
            </div>
            <div className="field">
              <label htmlFor="p-location">Location</label>
              <input id="p-location" value={location} onChange={e => setLocation(e.target.value)} placeholder="e.g. Seattle, WA" />
            </div>
          </div>

          {currentUser.isProfessional ? (
            <div style={{ marginBottom: 14 }}>
              <p className="hint" style={{ marginBottom: 8 }}>You&apos;re listed as a mentor/professional. Save changes below to update these details.</p>
              <button type="button" className="btn-ghost" onClick={unlistMe} disabled={listingBusy}>
                {listingBusy ? 'Working…' : 'Remove myself from Discover'}
              </button>
            </div>
          ) : (
            <div style={{ marginBottom: 14 }}>
              <button
                type="button"
                className="btn-outline btn-sm"
                onClick={listMe}
                disabled={!hasProfessionalDetails || listingBusy}
              >
                {listingBusy ? 'Listing…' : 'List me as a mentor/professional'}
              </button>
              {!hasProfessionalDetails && <p className="hint" style={{ marginTop: 6 }}>Add a company and job title first.</p>}
            </div>
          )}

          <div className="modal-actions" style={{ justifyContent: 'flex-start' }}>
            <button className="btn-primary btn-sm" onClick={save}>Save changes</button>
            <button className="btn-outline btn-sm" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="profile-grid">
          <div className="detail-card">
            <h3>About</h3>
            <p>{currentUser.bio}</p>
          </div>
          <div className="detail-card">
            <h3>Education</h3>
            <p>{currentUser.university}{currentUser.major ? `, ${currentUser.major}` : ''}</p>
          </div>
          <div className="detail-card">
            <h3>Skills &amp; interests</h3>
            <div className="skill-pills">
              {currentUser.skills.length ? currentUser.skills.map(s => <span key={s}>{s}</span>) : <span style={{ color: 'var(--ink-3)' }}>None added yet</span>}
            </div>
          </div>
          <div className="detail-card">
            <h3>Discoverability</h3>
            <div className="pf-card-avail">
              {currentUser.isProfessional ? (
                <span className="avail-pill referrals" style={{ background: 'var(--moss-soft)', color: 'var(--moss)' }}>Visible in Discover</span>
              ) : (
                <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>Not listed yet. List yourself as a mentor/professional above.</span>
              )}
              {currentUser.referralsAvailable && <span className="avail-pill referrals">Open to referrals</span>}
            </div>
          </div>
        </div>
      )}

      <h2 style={{ fontFamily: "'Fraunces', serif", fontSize: 19, color: 'var(--ink)', margin: '30px 0 14px' }}>Resume</h2>
      <div className="detail-card">
        {state.resume ? (
          <div className="resume-file">
            <div className="resume-file-info">
              <span className="resume-file-icon"><FileText size={18} /></span>
              <div>
                <div className="name">{state.resume.fileName}</div>
                <div className="meta">{state.resume.sizeLabel} &middot; uploaded {state.resume.uploadedAt} &middot; private by default</div>
              </div>
            </div>
            <div className="resume-actions">
              <button className="btn-outline btn-sm" onClick={handleDownload}><Download size={15} /> Download</button>
              <button className="btn-outline btn-sm" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                <Upload size={15} /> {uploading ? 'Uploading…' : 'Replace'}
              </button>
              <button className="btn-ghost" onClick={handleDelete}><Trash2 size={15} /> Delete</button>
            </div>
          </div>
        ) : (
          <div className="resume-drop">
            <UploadCloud className="resume-drop-icon" aria-hidden="true" />
            <strong>No resume uploaded</strong>
            Kept private here. You choose who to share it with from your Connections.
            <div style={{ marginTop: 14 }}>
              <button className="btn-primary btn-sm" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                <Upload size={15} /> {uploading ? 'Uploading…' : 'Upload resume'}
              </button>
            </div>
          </div>
        )}
        <input ref={fileInputRef} type="file" accept=".pdf,.doc,.docx" hidden onChange={handleFilePick} />
        <p className="hint" style={{ marginTop: 12 }}>PDF, DOC, or DOCX &middot; up to 5 MB. No one can see this until you choose to share it with a specific connection.</p>
      </div>
    </>
  );
}
