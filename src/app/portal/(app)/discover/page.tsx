'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePortalData } from '../../_lib/PortalDataProvider';
import { ApiError } from '../../_lib/api';
import type { Member } from '../../_lib/types';
import { SearchX } from 'lucide-react';
import Avatar from '../../_components/Avatar';
import CardSkeleton from '../../_components/CardSkeleton';
import { useToast } from '../../_components/Toast';

const EMPTY_TEXT = { search: '', company: '', industry: '', university: '' };

export default function DiscoverPage() {
  const { loadProfessionals, getCachedProfessionals } = usePortalData();
  const toast = useToast();
  // Dashboard fetches this exact unfiltered query too - if it (or an earlier
  // visit to this page) already ran this session, show it immediately
  // instead of blanking to a skeleton, so switching back and forth between
  // Dashboard and Discover doesn't re-flash a loading state for data that's
  // already sitting right there. Only used for the initial render and the
  // search effect's very first run (see hasMountedRef below), so it doesn't
  // matter that this isn't re-evaluated after that.
  const initialCache = getCachedProfessionals();
  const hasMountedRef = useRef(false);
  const [results, setResults] = useState<Member[]>(() => initialCache ?? []);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(() => initialCache === null);
  const [loadingMore, setLoadingMore] = useState(false);

  // What's typed right now vs. what's been sent to the server (debounced, so
  // typing doesn't fire a request per keystroke).
  const [text, setText] = useState(EMPTY_TEXT);
  const [applied, setApplied] = useState(EMPTY_TEXT);
  const [referralsOnly, setReferralsOnly] = useState(false);

  // Bumped on every new search so a slow "load more" from an old search can't
  // append its results to a newer one.
  const searchId = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const next = { ...text, search: text.search.trim() };
      // Bail out if nothing actually changed (e.g. the debounce firing once on
      // mount with the same empty filters) - setting a new-but-equal object
      // still re-triggers the search effect below since it compares by
      // reference, which was showing up as the results grid flashing back to
      // its loading skeleton right after the page had already loaded.
      setApplied(prev =>
        prev.search === next.search && prev.company === next.company &&
        prev.industry === next.industry && prev.university === next.university
          ? prev
          : next
      );
    }, 300);
    return () => window.clearTimeout(timer);
  }, [text]);

  const filters = { ...applied, referralsAvailable: referralsOnly };

  useEffect(() => {
    const id = ++searchId.current;
    const isDefaultQuery = !applied.search && !applied.company && !applied.industry && !applied.university && !referralsOnly;
    // Only the very first run, and only when it's the exact cached query, can
    // skip the loading flash - an actual search (or any later refetch) still
    // shows it, that's real "fetching new results" feedback, not a false blink.
    const skipLoadingFlash = !hasMountedRef.current && isDefaultQuery && initialCache !== null;
    hasMountedRef.current = true;
    // A fresh search is starting - not derivable from existing state, so this
    // has to be an explicit flag rather than a computed value.
    if (!skipLoadingFlash) setLoading(true);
    loadProfessionals({ ...applied, referralsAvailable: referralsOnly })
      .then(res => {
        if (searchId.current !== id) return;
        setResults(res.members);
        setHasMore(res.hasMore);
        setPage(1);
      })
      .catch(() => {
        if (searchId.current === id) setResults([]);
      })
      .finally(() => {
        if (searchId.current === id) setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applied, referralsOnly]);

  async function loadMore() {
    const id = searchId.current;
    setLoadingMore(true);
    try {
      const res = await loadProfessionals(filters, page + 1);
      if (searchId.current !== id) return;
      setResults(prev => [...prev, ...res.members]);
      setHasMore(res.hasMore);
      setPage(p => p + 1);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not load more people. Try again.', 'error');
    } finally {
      setLoadingMore(false);
    }
  }

  function resetFilters() {
    setText(EMPTY_TEXT);
    setApplied(EMPTY_TEXT);
    setReferralsOnly(false);
  }

  const hasFilters = text.search || text.company || text.industry || text.university || referralsOnly;

  return (
    <>
      <div className="portal-page-head">
        <h1>Discover</h1>
        <p>Find UPSA professionals and mentors by company, industry, or university, and reach out directly.</p>
      </div>

      <div className="filter-bar">
        <div className="filter-field" style={{ minWidth: 220 }}>
          <label htmlFor="f-search">Search</label>
          <input id="f-search" placeholder="Name, role, or skill" value={text.search} onChange={e => setText(t => ({ ...t, search: e.target.value }))} />
        </div>
        <div className="filter-field">
          <label htmlFor="f-company">Company</label>
          <input id="f-company" placeholder="Any company" value={text.company} onChange={e => setText(t => ({ ...t, company: e.target.value }))} />
        </div>
        <div className="filter-field">
          <label htmlFor="f-industry">Industry</label>
          <input id="f-industry" placeholder="Any industry" value={text.industry} onChange={e => setText(t => ({ ...t, industry: e.target.value }))} />
        </div>
        <div className="filter-field">
          <label htmlFor="f-university">University</label>
          <input id="f-university" placeholder="Any university" value={text.university} onChange={e => setText(t => ({ ...t, university: e.target.value }))} />
        </div>
        <div className="filter-checks">
          <label className="filter-check">
            <input type="checkbox" checked={referralsOnly} onChange={e => setReferralsOnly(e.target.checked)} /> Open to referrals
          </label>
        </div>
        {!!hasFilters && <button className="filter-reset" onClick={resetFilters}>Clear filters</button>}
      </div>

      <p className="filter-count">
        {loading ? 'Searching…' : `${results.length}${hasMore ? '+' : ''} professional${results.length === 1 && !hasMore ? '' : 's'} found`}
      </p>

      {loading && results.length === 0 ? (
        <div className="pf-grid">
          {Array.from({ length: 6 }).map((_, i) => <CardSkeleton key={i} />)}
        </div>
      ) : results.length === 0 ? (
        <div className="empty-state">
          <SearchX className="empty-state-icon" aria-hidden="true" />
          <span>No one matches those filters yet. Try clearing a few.</span>
        </div>
      ) : (
        // Re-searching (typing a filter, toggling referrals) keeps the
        // current cards on screen and just dims them instead of swapping to
        // the skeleton grid - that swap-back-and-forth is what was reading
        // as a flicker/blink, since it's not an actual page refresh.
        <div style={{ opacity: loading ? 0.5 : 1, transition: 'opacity .15s', pointerEvents: loading ? 'none' : undefined }}>
          <div className="pf-grid">
            {results.map(pro => {
              const isStudentType = Boolean(pro.university && pro.major);
              const isProfessionalType = Boolean(pro.company && pro.role);
              return (
                <Link href={`/portal/professionals/${pro.id}`} key={pro.id} className="pf-card">
                  <div className="pf-card-top">
                    <Avatar name={pro.name} initials={pro.initials} color={pro.avatarColor} imageUrl={pro.avatarUrl} size="md" />
                    <div>
                      <div className="pf-card-name">{pro.name}</div>
                      {(isStudentType || isProfessionalType) && (
                        <div className="pf-card-role-labels">
                          {isStudentType && <span>Student</span>}
                          {isProfessionalType && <span>Professional</span>}
                        </div>
                      )}
                      {isProfessionalType && (
                        <div className="pf-card-headline">{pro.role} · {pro.company}</div>
                      )}
                    </div>
                  </div>
                  {isStudentType && (
                    <div className="pf-card-meta">
                      <span>{pro.university}</span>
                      <span>{pro.major}</span>
                    </div>
                  )}
                  {pro.bio && <p className="pf-card-bio">{pro.bio}</p>}
                  {isProfessionalType && pro.referralsAvailable && (
                    <div className="pf-card-foot">
                      <div className="pf-card-avail">
                        <span className="avail-pill referrals">Open to referrals</span>
                      </div>
                    </div>
                  )}
                </Link>
              );
            })}
          </div>
          {hasMore && (
            <p style={{ textAlign: 'center', marginTop: 22 }}>
              <button className="btn-outline" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? 'Loading…' : 'Load more'}
              </button>
            </p>
          )}
        </div>
      )}
    </>
  );
}
