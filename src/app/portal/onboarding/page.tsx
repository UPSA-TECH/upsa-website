'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useUser } from '@clerk/nextjs';
import { PLACEHOLDER_NAME, usePortalData } from '../_lib/PortalDataProvider';
import { ApiError } from '../_lib/api';
import Avatar from '../_components/Avatar';
import BrandMark from '../_components/BrandMark';
import { useToast } from '../_components/Toast';

const ALLOWED_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export default function OnboardingPage() {
  const router = useRouter();
  const { currentUser, updateProfile, uploadAvatar } = usePortalData();
  const toast = useToast();
  const [step, setStep] = useState(currentUser.hasAvatar ? 2 : 1);
  const [uploading, setUploading] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { user } = useUser();
  const [name, setName] = useState(currentUser.name === PLACEHOLDER_NAME ? (user?.fullName ?? '') : currentUser.name);
  const [isStudent, setIsStudent] = useState(Boolean(currentUser.university || currentUser.major));
  const [isProfessional, setIsProfessional] = useState(Boolean(currentUser.isProfessional || currentUser.company || currentUser.role));
  const [university, setUniversity] = useState(currentUser.university);
  const [major, setMajor] = useState(currentUser.major ?? '');
  const [company, setCompany] = useState(currentUser.company ?? '');
  const [role, setRole] = useState(currentUser.role ?? '');
  const [industry, setIndustry] = useState(currentUser.industry ?? '');

  const studentReady = !isStudent || (university.trim() && major.trim());
  const professionalReady = !isProfessional || (company.trim() && role.trim());
  const canFinish = name.trim() && (isStudent || isProfessional) && studentReady && professionalReady;

  async function handlePhotoPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!ALLOWED_PHOTO_TYPES.includes(file.type)) {
      toast('Please upload a JPG, PNG, or WEBP image.', 'error');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast('Profile photos are limited to 5 MB.', 'error');
      return;
    }
    setPreviewUrl(URL.createObjectURL(file));
    setUploading(true);
    try {
      await uploadAvatar(file);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not upload that photo. Try again.', 'error');
      setPreviewUrl(null);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  async function finish() {
    setFinishing(true);
    try {
      await updateProfile({
        name,
        university: isStudent ? university : '',
        major: isStudent ? major : '',
        company: isProfessional ? company : '',
        role: isProfessional ? role : '',
        industry: isProfessional ? industry : '',
        isProfessional,
      });
      router.push('/portal/dashboard');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not save your profile. Try again.', 'error');
    } finally {
      setFinishing(false);
    }
  }

  return (
    <div className="portal-guest">
      <header className="portal-guest-header">
        <span className="portal-guest-brand"><BrandMark /></span>
        <Link href="/portal" className="portal-guest-back">Save &amp; exit</Link>
      </header>

      <div className="portal-auth-wrap">
        <div className="portal-auth-card wide">
          <div className="onboarding-steps">
            <span className={step >= 1 ? 'done' : ''} />
            <span className={step >= 2 ? 'done' : ''} />
          </div>

          {step === 1 && (
            <>
              <h1>Add a profile photo</h1>
              <p className="sub">Required so other members know who they&apos;re talking to. JPG, PNG, or WEBP, up to 5 MB.</p>

              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, margin: '10px 0 26px' }}>
                <Avatar
                  name={name || 'You'}
                  initials={currentUser.initials || 'U'}
                  color={currentUser.avatarColor}
                  size="lg"
                  imageUrl={previewUrl ?? currentUser.avatarUrl}
                />
                <button type="button" className="btn-outline btn-sm" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                  {uploading ? 'Uploading…' : currentUser.hasAvatar || previewUrl ? 'Replace photo' : 'Choose photo'}
                </button>
                <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={handlePhotoPick} />
              </div>

              <div className="field">
                <label htmlFor="name">Full name</label>
                <input id="name" value={name} onChange={e => setName(e.target.value)} />
              </div>

              <button
                className="btn-primary"
                style={{ width: '100%', justifyContent: 'center' }}
                onClick={() => setStep(2)}
                disabled={(!currentUser.hasAvatar && !previewUrl) || !name.trim()}
              >
                Continue &rarr;
              </button>
              {(!currentUser.hasAvatar && !previewUrl) || !name.trim() ? (
                <p className="hint" style={{ marginTop: 10, textAlign: 'center' }}>A photo and your name are required to continue.</p>
              ) : null}
            </>
          )}

          {step === 2 && (
            <>
              <h1>I am a...</h1>
              <p className="sub">Check what applies - you can be both. Fill in the details below so other members can find you right away.</p>

              <div className="type-choice-field" style={{ marginBottom: 18 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, cursor: 'pointer' }}>
                  <input type="checkbox" checked={isStudent} onChange={e => setIsStudent(e.target.checked)} />
                  I&apos;m a student
                </label>
                {isStudent && (
                  <div className="field-row" style={{ marginLeft: 26 }}>
                    <div className="field">
                      <label htmlFor="university">University</label>
                      <input id="university" value={university} onChange={e => setUniversity(e.target.value)} placeholder="e.g. UCF" />
                    </div>
                    <div className="field">
                      <label htmlFor="major">Major</label>
                      <input id="major" value={major} onChange={e => setMajor(e.target.value)} placeholder="e.g. Computer Science" />
                    </div>
                  </div>
                )}
              </div>

              <div className="type-choice-field" style={{ marginBottom: 18 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, cursor: 'pointer' }}>
                  <input type="checkbox" checked={isProfessional} onChange={e => setIsProfessional(e.target.checked)} />
                  I&apos;m a professional
                </label>
                {isProfessional && (
                  <>
                    <div className="field-row" style={{ marginLeft: 26 }}>
                      <div className="field">
                        <label htmlFor="company">Company</label>
                        <input id="company" value={company} onChange={e => setCompany(e.target.value)} placeholder="e.g. Microsoft" />
                      </div>
                      <div className="field">
                        <label htmlFor="role">Job title</label>
                        <input id="role" value={role} onChange={e => setRole(e.target.value)} placeholder="e.g. Software Engineer" />
                      </div>
                    </div>
                    <div className="field" style={{ marginLeft: 26 }}>
                      <label htmlFor="industry">Industry</label>
                      <input id="industry" value={industry} onChange={e => setIndustry(e.target.value)} placeholder="e.g. Technology" />
                    </div>
                    <p className="hint" style={{ marginLeft: 26 }}>You&apos;ll be listed in Discover right away, no review wait.</p>
                  </>
                )}
              </div>

              {!(isStudent || isProfessional) && (
                <p className="hint" style={{ marginBottom: 14 }}>Check at least one to continue.</p>
              )}

              <div style={{ display: 'flex', gap: 10 }}>
                <button className="btn-outline" onClick={() => setStep(1)}>Back</button>
                <button className="btn-primary" style={{ flex: 1, justifyContent: 'center' }} onClick={finish} disabled={!canFinish || finishing}>
                  {finishing ? 'Finishing…' : 'Finish setup →'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
