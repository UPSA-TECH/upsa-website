// Styles Clerk's <SignIn>/<SignUp> to match the portal (paper/moss theme,
// Geist + Geist Mono, pill buttons, 3px inputs like .field in portal.css).
//
// Everything goes through Clerk's appearance API on purpose: styles set here
// are applied by Clerk itself with the right specificity, so there's no
// !important and no CSS reaching into Clerk's internal markup (which Clerk
// warns can break when its components update).
//
// Hex values mirror the tokens in globals.css / portal.css, since Clerk's
// styles can't read CSS variables reliably in every element.
import type { ComponentProps } from 'react';
import type { SignIn } from '@clerk/nextjs';

type ClerkAppearance = NonNullable<ComponentProps<typeof SignIn>['appearance']>;

const MOSS = '#1F4D32';
const MOSS_MID = '#2C6844';
const MOSS_SOFT = '#E8EFE5';
const INK = '#1A1F18';
const INK_2 = '#3A4138';
const INK_3 = '#5C6359';
const PAPER = '#F7F2E8';
const RULE = '#D8CFB8';
const DANGER = '#8C3B2E';
const SANS = "'Geist', sans-serif";
const MONO = "'Geist Mono', monospace";

const monoLabel = {
  fontFamily: MONO,
  fontSize: '11px',
  fontWeight: 400,
  letterSpacing: '.08em',
  textTransform: 'uppercase',
  color: INK_2,
} as const;

export const portalClerkAppearance = {
  variables: {
    colorPrimary: MOSS,
    colorPrimaryForeground: '#ffffff',
    colorDanger: DANGER,
    colorForeground: INK,
    colorMutedForeground: INK_3,
    colorNeutral: INK,
    // White, same as the card around it - a tinted background here is what
    // showed up as beige bands above/below Clerk's content.
    colorBackground: '#ffffff',
    colorInput: PAPER,
    colorInputForeground: INK,
    colorBorder: RULE,
    colorRing: MOSS_SOFT,
    colorShadow: 'transparent',
    fontFamily: SANS,
    fontFamilyButtons: SANS,
    fontSize: '14px',
    borderRadius: '3px',
  },
  options: {
    logoPlacement: 'none',
    socialButtonsVariant: 'blockButton',
    socialButtonsPlacement: 'top',
  },
  elements: {
    rootBox: { width: '100%' },
    // cardBox is Clerk's outer frame (border + shadow) - the second card that
    // made it look like a card inside our card.
    cardBox: { width: '100%', maxWidth: '100%', border: 'none', boxShadow: 'none', borderRadius: 0, background: 'transparent', overflow: 'visible' },
    card: { width: '100%', padding: 0, margin: 0, gap: '20px', border: 'none', boxShadow: 'none', borderRadius: 0, background: 'transparent' },
    // Our own heading sits above the form, so Clerk's duplicate title goes.
    header: { display: 'none' },
    main: { gap: '18px' },

    socialButtonsRoot: { margin: 0 },
    socialButtons: { gap: '10px' },
    socialButtonsBlockButton: {
      height: '48px',
      padding: '0 18px',
      borderRadius: '999px',
      border: `1.5px solid ${RULE}`,
      boxShadow: 'none',
      background: '#ffffff',
      color: INK,
      transition: 'border-color .18s, background-color .18s',
      '&:hover': { borderColor: MOSS, background: PAPER },
      '&:focus-visible': { outline: `2px solid ${MOSS}`, outlineOffset: '2px' },
    },
    socialButtonsBlockButtonText: { fontFamily: SANS, fontSize: '14px', fontWeight: 500, color: INK },
    socialButtonsProviderIcon: { width: '18px', height: '18px' },
    lastAuthenticationStrategyBadge: {
      background: MOSS,
      color: '#ffffff',
      border: 'none',
      fontFamily: MONO,
      fontSize: '9.5px',
      fontWeight: 500,
      letterSpacing: '.05em',
      textTransform: 'uppercase',
      borderRadius: '999px',
    },

    // The "or" divider: no extra margin - main's gap already spaces it.
    dividerRow: { margin: 0 },
    dividerLine: { background: RULE, height: '1px' },
    dividerText: { ...monoLabel, color: INK_3, margin: '0 14px' },

    form: { gap: '16px' },
    formFieldRow: { margin: 0 },
    formFieldLabel: monoLabel,
    formFieldLabelRow: { marginBottom: '6px' },
    formFieldAction: { fontFamily: SANS, fontSize: '12.5px', fontWeight: 500, color: MOSS },
    formFieldInput: {
      height: '48px',
      padding: '0 14px',
      fontFamily: SANS,
      fontSize: '15px',
      color: INK,
      background: PAPER,
      border: `1.5px solid ${RULE}`,
      borderRadius: '3px',
      boxShadow: 'none',
      transition: 'border-color .18s, box-shadow .18s, background-color .18s',
      '&:hover': { borderColor: '#b9ae8c' },
      '&:focus': { borderColor: MOSS, background: '#ffffff', boxShadow: `0 0 0 4px ${MOSS_SOFT}`, outline: 'none' },
    },
    formFieldInputShowPasswordButton: { color: INK_3, '&:hover': { color: MOSS } },
    otpCodeFieldInput: { borderColor: RULE, borderRadius: '3px', '&:focus': { borderColor: MOSS } },

    // Same look as .btn-primary: moss pill, Geist 500, no Clerk gradient.
    formButtonPrimary: {
      height: '48px',
      marginTop: '4px',
      borderRadius: '999px',
      background: MOSS,
      backgroundImage: 'none',
      border: 'none',
      boxShadow: '0 10px 26px -10px rgba(14, 44, 27, .45)',
      fontFamily: SANS,
      fontSize: '14.5px',
      fontWeight: 500,
      letterSpacing: 0,
      textTransform: 'none',
      transition: 'background-color .2s, box-shadow .2s',
      '&::after': { display: 'none' },
      '&:hover': { background: MOSS_MID },
      '&:focus-visible': { outline: `2px solid ${MOSS}`, outlineOffset: '3px' },
    },
    formButtonReset: { color: MOSS, fontWeight: 500 },
    alternativeMethodsBlockButton: {
      height: '46px',
      borderRadius: '999px',
      border: `1.5px solid ${RULE}`,
      boxShadow: 'none',
      '&:hover': { borderColor: MOSS, background: PAPER },
    },
    identityPreview: { borderRadius: '999px', border: `1.5px solid ${RULE}`, background: PAPER },
    identityPreviewEditButton: { color: MOSS },
    backLink: { color: MOSS },

    // Clerk's footer band: transparent, and its "Don't have an account?" link
    // is replaced by the portal's own Sign in / Create account switch.
    footer: { background: 'transparent', marginTop: '4px', '& > div': { background: 'transparent' } },
    footerAction: { display: 'none' },
    footerActionLink: { color: MOSS, fontWeight: 600 },
  },
} satisfies ClerkAppearance;
