# Puneri Mallus Repository File Lineage

> Generated from a static source-tree audit on 2026-08-24. This document describes purpose, consumers, dependencies, and runtime lineage for every source, configuration, script, and public asset file in the repository, excluding generated `.next/` and installed `node_modules/` contents.
>
> Static analysis cannot prove runtime consumers for database-provided URLs, browser navigation, uploads, or external systems. Those cases are called out explicitly rather than guessed.

## 1. System Overview

This is a Next.js App Router application for the Puneri Mallus community. The main runtime layers are:

- **Global shell:** `app/layout.tsx` composes `Navbar`, `Preloader`, `AlertProvider`, `Footer`, `ConditionalGate`, analytics, Razorpay, and WhatsApp UI around every route.
- **Pages:** `app/**/page.tsx` files implement public, authentication, football, directory, community, and admin screens.
- **Server endpoints:** `app/api/**/route.ts` files expose HTTP handlers for pages and admin tools.
- **Authentication:** Supabase sessions and users, with Firebase phone authentication used by client-side onboarding and gate flows.
- **Data:** MongoDB/Mongoose for content and support data; Supabase for authentication, profiles, memberships, payments, football, admin authorization, logs, settings, and storage.
- **External services:** Razorpay payments, Nodemailer/Gmail email, Vercel Analytics/Speed Insights, Google-hosted metadata image, and WhatsApp links.
- **Request protection:** `proxy.ts` refreshes Supabase sessions and restricts API access for unauthenticated requests.

## 2. Runtime Lineage

```text
app/layout.tsx
  -> Navbar, Preloader, AlertProvider, Footer, ConditionalGate, WhatsAppTribe
  -> every App Router page
  -> app/globals.css, Supabase/Firebase clients, Vercel analytics, Razorpay script

public pages
  -> client fetches -> app/api/** routes
  -> API routes -> MongoDB/Mongoose, Supabase, Storage, Razorpay, mail

admin pages
  -> app/admin/layout.tsx -> lib/admin.ts -> Supabase authorized_admins
  -> admin UI -> admin/manage/delete/reorder/settings API routes

forms
  -> validation and upload components
  -> API handlers
  -> database and Supabase Storage
  -> notification/receipt email through lib/mail.ts
```

## 3. Root Files

### `.env.local`

**Purpose:** Local runtime secrets and environment configuration. Expected values include MongoDB, Supabase, email, site URL, and Razorpay settings.

**Lineage:** Loaded directly by Next.js/server runtime and by `migrate.js`; values are read through `process.env` in server libraries and API routes. It is not imported as source code.

**Important:** This file is secret-sensitive. Its values should never be copied into this documentation, committed, or exposed to client code unless deliberately prefixed with `NEXT_PUBLIC_`.

### `.gitignore`

**Purpose:** Defines files Git should omit, normally including dependencies, build output, local environment files, and editor/system artifacts.

**Lineage:** Consumed by Git tooling only. It has no application runtime consumer.

### `REPOSITORY_FILE_LINEAGE.md`

**Purpose:** This repository-wide file lineage and architecture reference.

**Lineage:** Read by developers and documentation tooling. It is not imported or executed by the application.

### `README.md`

**Purpose:** Human-facing project setup and usage documentation.

**Lineage:** Read by developers and repository tooling. It does not execute at runtime. Its documented framework/font details should be checked against the implementation in `package.json` and `app/layout.tsx`.

### `package.json`

**Purpose:** Declares the Next.js/React application metadata, scripts, and direct dependencies.

**Lineage:** npm and Next.js consume it. Scripts provide the development, production build, production start, and lint entry points. Dependencies used by the source include Next, React, Supabase, Firebase, MongoDB/Mongoose, Nodemailer, Razorpay, Tailwind/PostCSS, Vercel analytics, and UI helpers.

### `package-lock.json`

**Purpose:** Pins the complete npm dependency tree and versions.

**Lineage:** npm install/CI consumes it to reproduce `package.json` dependencies. It is not imported by application code.

### `eslint.config.mjs`

**Purpose:** ESLint configuration for Next.js Core Web Vitals and TypeScript rules.

**Lineage:** Consumed by the lint script/tooling; it does not affect production runtime behavior.

### `global.d.ts`

**Purpose:** Global TypeScript declaration scaffold. It is currently empty.

**Lineage:** TypeScript includes declaration files through `tsconfig.json`; there are no active declarations in this file.

### `migrate.js`

**Purpose:** Manual MongoDB migration script that transfers data from `puneri_mallus` to `punerimallus`.

**Lineage:** Run manually with Node, loads `.env.local`, connects to MongoDB, and copies database content. It is not imported by the Next.js application and has no route consumer.

### `next-env.d.ts`

**Purpose:** Next-generated TypeScript environment declarations.

**Lineage:** Included by TypeScript and references generated route types under `.next/dev/types/routes.d.ts`. It is build/tooling support, not runtime application logic.

### `next.config.ts`

**Purpose:** Next.js configuration for image optimization, allowed remote image hosts, caching, and trailing-slash behavior.

**Lineage:** Consumed by Next.js during development, build, and server startup. It controls whether external images used by pages/components can be optimized.

### `postcss.config.js`

**Purpose:** Legacy PostCSS configuration using Tailwind/autoprefixer.

**Lineage:** Potentially consumed by PostCSS depending on config resolution. It overlaps with `postcss.config.mjs`, creating configuration-selection ambiguity.

### `postcss.config.mjs`

**Purpose:** PostCSS configuration using the Tailwind v4 plugin.

**Lineage:** Consumed by Next.js/PostCSS while processing `app/globals.css` and other styles. Its coexistence with `postcss.config.js` should be understood when diagnosing CSS builds.

### `proxy.ts`

**Purpose:** Request middleware/proxy for Supabase session refresh and API authorization.

**Lineage:** Next.js discovers it as the project proxy entry point. It calls Supabase server helpers, refreshes cookies, permits selected unauthenticated routes, and blocks non-whitelisted unauthenticated API requests.

### `tailwind.config.js`

**Purpose:** Tailwind configuration, including source content paths and the `brandRed` color.

**Lineage:** Consumed by Tailwind/PostCSS while processing class names used throughout `app/` and `components/`.

### `tsconfig.json`

**Purpose:** TypeScript compiler configuration, included source patterns, strictness, and path aliases such as `@/*`.

**Lineage:** Consumed by TypeScript, ESLint, Next.js, and editor language services. The aliases enable imports such as `@/components/Navbar`.

## 4. App Shell and Styling

### `app/layout.tsx`

**Purpose:** Root layout and global document shell. Defines metadata, Inter font loading, dark HTML/body styling, global providers, navigation, preloader, footer, path gate, analytics, Razorpay checkout loading, and WhatsApp CTA.

**Lineage:** Next.js applies it above every descendant route. It imports `app/globals.css`, `Navbar`, `Preloader`, `AlertProvider`, `Footer`, `ConditionalGate`, `WhatsAppTribe`, Vercel analytics, and `next/script`.

### `app/globals.css`

**Purpose:** Global Tailwind/style layer, black/red theme variables, scrolling/background behavior, reduced-motion handling, mobile blur adjustments, and reusable utility styles.

**Lineage:** Imported by `app/layout.tsx`, so it applies globally to all pages and components.

### `app/icon.png`

**Purpose:** Next.js convention-based application favicon/icon.

**Lineage:** Discovered automatically by Next.js from the `app` directory and emitted as application metadata. No source import is required.

## 5. Public Pages

### `app/page.tsx`

**Purpose:** Homepage. Loads slider configuration and events, then renders hero content, upcoming/past events, videos, founder content, event cards, and popup collaboration advertising.

**Lineage:** Route `/`. Fetches `/api/settings/slider` and `/api/events`; uses `EventCard` and `Popup`; inherits the root layout.

### `app/about/page.tsx`

**Purpose:** About/community page with gallery/team data, membership content, videos, founder imagery, and community storytelling.

**Lineage:** Route `/about`. Fetches gallery/team settings; uses `InstagramGlimpse`, `Membership`, global shell components, and assets under `public/about`, `public/founders`, and `public/events`.

### `app/events/page.tsx`

**Purpose:** Public event listing with filtering/sorting and ticket links.

**Lineage:** Route `/events`. Fetches `/api/events`; renders event information and reusable `EventCard` UI.

### `app/contact/page.tsx`

**Purpose:** Public contact/support form with WhatsApp contact option.

**Lineage:** Route `/contact`. Posts form data to `/api/contact`; uses contact background media and global alert/UI facilities.

### `app/privacy/page.tsx`

**Purpose:** Static privacy policy page.

**Lineage:** Route `/privacy`. Rendered through `app/layout.tsx`; linked from `Footer` and potentially other legal/navigation UI.

### `app/terms/page.tsx`

**Purpose:** Static terms and conditions page.

**Lineage:** Route `/terms`. Rendered through `app/layout.tsx`; linked from `Footer` and potentially other legal/navigation UI.

### `app/farewell/page.tsx`

**Purpose:** Farewell/exit page that directs users toward signup.

**Lineage:** Route `/farewell`. Navigation target is selected by UI/browser interaction; inherited global shell applies.

### `app/profile/page.tsx`

**Purpose:** Authenticated profile management, including profile fields and account deletion.

**Lineage:** Route `/profile`. Uses browser Supabase auth, Firebase auth, `TribeCalendar`, `/api/profile/check`, `/api/profile/check-email`, `/api/profile/onboard`, `/api/profile/delete`, and alert/context components.

### `app/football/closed/page.tsx`

**Purpose:** Static notice that football registration is closed, with phone/contact and home links.

**Lineage:** Route `/football/closed`. No data/API dependency identified; inherits the global shell.

### `app/football/register/page.tsx`

**Purpose:** Football/MPL registration form, email uniqueness check, submission, and rules PDF display.

**Lineage:** Route `/football/register`. Calls `/api/football/check-email` and `/api/football/register`; final payment/team persistence may continue through Razorpay flows elsewhere.

### `app/partners/page.tsx`

**Purpose:** Public partner/member directory.

**Lineage:** Route `/partners`. Fetches `/api/partners`; links to `/partners/[id]`; uses partner page imagery and global components.

### `app/partners/[id]/page.tsx`

**Purpose:** Dynamic partner profile with contact, phone, Instagram, website, and WhatsApp links.

**Lineage:** Route `/partners/:id`. Fetches `/api/partners?id=...`; partner data and links are database-driven.

### `app/community/page.tsx`

**Purpose:** Public community directory with filtering/detail links and authorized deletion behavior.

**Lineage:** Route `/community`. Fetches `/api/community`; links to `/community/[id]` and `/community/add`; uses `WhatsappTribe` and alert/auth state.

### `app/community/[id]/page.tsx`

**Purpose:** Dynamic community detail route.

**Lineage:** Route `/community/:id`. Delegates detail rendering to `components/community/NodeDetails.tsx`, which loads or displays community member, photo, service, and map information.

### `app/community/add/page.tsx`

**Purpose:** Community creation/edit form with name validation, email verification, image upload, opening hours, and edit support.

**Lineage:** Route `/community/add`. Uses `EmailVerificationGate`, `TribeTimePicker`, `/api/check-name`, `/api/community`, `/api/community/manage`, Supabase Storage, and global alerts.

### `app/directory/page.tsx`

**Purpose:** Public Mallu Mart directory with search/filtering, listing details, edits, WhatsApp links, and submission entry point.

**Lineage:** Route `/directory`. Fetches `/api/mart`; links to `/directory/[id]` and `/directory/list`; uses Mallu Mart imagery and verification/subscription UI where applicable.

### `app/directory/[id]/page.tsx`

**Purpose:** Dynamic Mallu Mart listing detail, subscription/payment entry, verification state, and listing actions.

**Lineage:** Route `/directory/:id`. Fetches listing/settings/profile state; uses `MartInvoiceGate`, `MartVerificationModal`, Razorpay order/verification APIs, and `/api/business/verify`/`/api/mart` flows.

### `app/directory/list/page.tsx`

**Purpose:** Mallu Mart listing creation/edit form with email verification, duplicate-name checking, image/document upload, and business hours.

**Lineage:** Route `/directory/list`. Uses `EmailVerificationGate`, `TribeTimePicker`, `/api/check-name`, and `/api/mart`.

## 6. Authentication Pages

### `app/auth/login/page.tsx`

**Purpose:** Supabase email/password login screen.

**Lineage:** Route `/auth/login`. Uses browser Supabase auth and redirects based on login result; global layout and `proxy.ts` participate in session handling.

### `app/auth/signup/page.tsx`

**Purpose:** Signup/profile onboarding flow with Supabase authentication, Firebase phone verification, calendar input, and account-status checking.

**Lineage:** Route `/auth/signup`. Calls `/api/auth/check-status`; uses `TribeCalendar`, Supabase, Firebase, and profile onboarding APIs.

### `app/auth/forgot-password/page.tsx`

**Purpose:** Password-reset request form.

**Lineage:** Route `/auth/forgot-password`. Calls `/api/profile/check-email` before or during reset flow and uses Supabase auth.

### `app/auth/update-password/page.tsx`

**Purpose:** Supabase password update screen reached from recovery flow.

**Lineage:** Route `/auth/update-password`. Uses the active Supabase recovery session.

### `app/auth/verified/page.tsx`

**Purpose:** Static email-verification success page.

**Lineage:** Route `/auth/verified`. Serves as a post-verification navigation target; no direct data dependency identified.

### `app/auth/callback/route.ts`

**Purpose:** Server callback endpoint for authentication redirects.

**Lineage:** Route `/auth/callback`. Invoked by Supabase/OAuth redirect configuration; exchanges or finalizes auth state and redirects the browser.

### `app/auth/confirm/route.ts`

**Purpose:** Server confirmation endpoint for authentication/email confirmation flows.

**Lineage:** Route `/auth/confirm`. Invoked by auth links or Supabase confirmation flow; final runtime behavior is driven by the incoming request parameters.

## 7. Admin Shell and Screens

### `app/admin/layout.tsx`

**Purpose:** Server-side admin authorization boundary.

**Lineage:** Wraps every `/admin/**` route. Requires a Supabase session and a matching `authorized_admins` record through `lib/admin.ts`; redirects unauthenticated users to login and unauthorized users to the home route.

### `app/admin/page.tsx`

**Purpose:** Admin dashboard/module launcher.

**Lineage:** Route `/admin`. Links to admin modules and uses `AddAdminCard` for administrator management.

### `app/admin/action.ts`

**Purpose:** Server actions for adding/revoking admins and writing `admin_audit_logs`.

**Lineage:** Imported by admin UI, especially `MemberActivityList`/admin member management. Uses Supabase server access and revalidates affected routes after mutations.

### `app/admin/members/page.tsx`

**Purpose:** Admin/member activity view.

**Lineage:** Route `/admin/members`. Uses `MemberActivityList` and `AddAdminCard`; reads administrative activity and supports revocation.

### `app/admin/events/page.tsx`

**Purpose:** Admin event CRUD, date/time controls, asset upload/replacement, and audit logging.

**Lineage:** Route `/admin/events`. Uses `TribeCalendar`, `TribeTimePicker`, `/api/events/manage`, `/api/events/delete`, and event storage.

### `app/admin/community/page.tsx`

**Purpose:** Community approval, rejection, and deletion dashboard.

**Lineage:** Route `/admin/community`. Reads and mutates community records through `/api/community`, `/api/community/manage`, and `/api/community/delete`.

### `app/admin/community/list/page.tsx`

**Purpose:** Admin community create/edit management screen.

**Lineage:** Route `/admin/community/list`. Shares form concepts with public community creation and uses `/api/community/manage`, name checks, verification, uploads, and `TribeTimePicker`.

### `app/admin/mart/page.tsx`

**Purpose:** Mallu Mart moderation, approval, rejection, deletion, and verification-document review.

**Lineage:** Route `/admin/mart`. Uses `/api/mart`, `/api/business/verify`, storage-backed documents, and admin authorization.

### `app/admin/partners/page.tsx`

**Purpose:** Partner moderation, deletion, and ordering.

**Lineage:** Route `/admin/partners`. Uses `/api/partners`, `/api/partners/delete`, and `/api/partners/reorder`.

### `app/admin/partners/list/page.tsx`

**Purpose:** Admin partner create/edit form.

**Lineage:** Route `/admin/partners/list`. Uses `/api/partners/manage`, partner storage, form validation, and alert UI.

### `app/admin/football/page.tsx`

**Purpose:** Football settings and team-registration administration.

**Lineage:** Route `/admin/football`. Reads `/api/admin/football`, manages football configuration through admin settings APIs, and relates to `football_teams`/`post_registration` data.

### `app/admin/gallery/page.tsx`

**Purpose:** Gallery asset and archive-gallery settings management.

**Lineage:** Route `/admin/gallery`. Uses `/api/settings/gallery` and Supabase Storage/MongoDB site settings.

### `app/admin/slider/page.tsx`

**Purpose:** Homepage slider management.

**Lineage:** Route `/admin/slider`. Uses `/api/settings/slider`, storage-backed media, and data consumed by `app/page.tsx`.

### `app/admin/social/page.tsx`

**Purpose:** Instagram/social glimpse configuration.

**Lineage:** Route `/admin/social`. Uses `/api/settings/social`; data is consumed by `components/about/InstagramGlimpse.tsx`.

### `app/admin/team/page.tsx`

**Purpose:** Team member management and ordering.

**Lineage:** Route `/admin/team`. Uses `/api/team`; data is consumed by `app/about/page.tsx` or related team presentation.

### `app/admin/payments/page.tsx`

**Purpose:** Payment configuration and payment-record administration.

**Lineage:** Route `/admin/payments`. Uses `/api/admin/payments` and `/api/admin/settings`; reads Supabase payment/settings data.

### `app/admin/support/page.tsx`

**Purpose:** Support-ticket management.

**Lineage:** Route `/admin/support`. Uses `/api/admin/support`, which reads and updates the Mongoose `SupportTicket` model.

### `app/admin/collabs/page.tsx`

**Purpose:** Collaboration/popup advertisement management.

**Lineage:** Route `/admin/collabs`. Uses `/api/admin/popup`; manages MongoDB popup records and `ads` storage consumed by `components/Popup.tsx`.

## 8. API Routes

### `app/api/admin/create/route.ts`

**Purpose:** Creates an auth user and corresponding `authorized_admins` record, then sends admin-access email.

**Lineage:** Called by `components/admin/AddAdminCard.tsx`; uses Supabase service/admin operations and `lib/mail.ts`.

### `app/api/admin/football/route.ts`

**Purpose:** Authenticated admin read endpoint for `football_teams`.

**Lineage:** Called by `app/admin/football/page.tsx`; protected by admin/session checks and Supabase.

### `app/api/admin/payments/route.ts`

**Purpose:** Admin read endpoint for payment records.

**Lineage:** Called by `app/admin/payments/page.tsx`; reads Supabase `payments` after authorization.

### `app/api/admin/popup/route.ts`

**Purpose:** Popup/collaboration CRUD and associated `ads` storage cleanup.

**Lineage:** Called by `app/admin/collabs/page.tsx`; writes MongoDB and Supabase Storage. Active popup data is read by `components/Popup.tsx`.

### `app/api/admin/settings/route.ts`

**Purpose:** Reads and updates Supabase `app_settings`.

**Lineage:** Called by admin settings/payment/football UI; protected by admin authorization.

### `app/api/admin/support/route.ts`

**Purpose:** Reads and updates Mongoose `SupportTicket` documents.

**Lineage:** Called by `app/admin/support/page.tsx`; uses `models/SupportTicket.ts` and `lib/mongodb.ts`.

### `app/api/auth/check-status/route.ts`

**Purpose:** Checks Supabase user/account status by ID.

**Lineage:** Called by `app/auth/signup/page.tsx` and onboarding logic.

### `app/api/business/verify/route.ts`

**Purpose:** Reads and updates business verification state in `directory_owners`.

**Lineage:** Called by Mallu Mart detail/admin verification flows; uses Supabase and business identity data.

### `app/api/check-name/route.ts`

**Purpose:** Duplicate-name checking across MongoDB `community_circles` and `mallu_mart`.

**Lineage:** Called by community and Mallu Mart forms before create/update operations.

### `app/api/community/route.ts`

**Purpose:** Public community reads, including single and filtered results from `community_circles`.

**Lineage:** Called by `app/community/page.tsx`, detail flows, and other community UI; reads MongoDB.

### `app/api/community/manage/route.ts`

**Purpose:** Creates, updates, approves, and rejects community records and sends notification email.

**Lineage:** Called by public/admin community forms and moderation screens; uses MongoDB, Supabase Storage, `lib/mail.ts`, and admin authorization.

### `app/api/community/delete/route.ts`

**Purpose:** Deletes community records and related Supabase Storage files.

**Lineage:** Called by authorized community/admin deletion UI; coordinates MongoDB deletion with Storage cleanup.

### `app/api/contact/route.ts`

**Purpose:** Stores contact/support submissions and sends email.

**Lineage:** Called by `app/contact/page.tsx`; uses Mongoose/`SupportTicket`, `lib/mongodb.ts`, and `lib/mail.ts`.

### `app/api/events/route.ts`

**Purpose:** Public event reads from MongoDB `events`.

**Lineage:** Called by `app/page.tsx` and `app/events/page.tsx`; returns event data consumed by `EventCard` and page-level filters.

### `app/api/events/manage/route.ts`

**Purpose:** Creates/updates events and removes replaced media assets.

**Lineage:** Called by `app/admin/events/page.tsx`; uses MongoDB, Supabase Storage, and admin checks.

### `app/api/events/delete/route.ts`

**Purpose:** Deletes events and their storage assets.

**Lineage:** Called by admin event management UI; coordinates database and Storage deletion.

### `app/api/football/check-email/route.ts`

**Purpose:** Checks email uniqueness in football registration data.

**Lineage:** Called by `app/football/register/page.tsx`; reads Supabase `football_teams`.

### `app/api/football/register/route.ts`

**Purpose:** Inserts football registration data into Supabase `post_registration`.

**Lineage:** Called by `app/football/register/page.tsx`; registration/payment continuation may also involve Razorpay verification.

### `app/api/mart/route.ts`

**Purpose:** Mallu Mart listing CRUD and moderation over MongoDB `mallu_mart`; handles `mallu-mart` storage and admin authorization.

**Lineage:** Called by directory pages, forms, verification modal, and admin moderation. Coordinates MongoDB and Supabase Storage.

### `app/api/partners/route.ts`

**Purpose:** Public partner reads from MongoDB `partners`.

**Lineage:** Called by `app/partners/page.tsx` and `app/partners/[id]/page.tsx`.

### `app/api/partners/manage/route.ts`

**Purpose:** Creates/updates partner records and removes replaced images.

**Lineage:** Called by `app/admin/partners/list/page.tsx`; uses MongoDB, Storage, and admin authorization.

### `app/api/partners/delete/route.ts`

**Purpose:** Deletes partner records and associated storage assets.

**Lineage:** Called by partner admin UI.

### `app/api/partners/reorder/route.ts`

**Purpose:** Bulk-updates partner display ordering.

**Lineage:** Called by `app/admin/partners/page.tsx`; updates MongoDB ordering fields.

### `app/api/profile/check-email/route.ts`

**Purpose:** Checks whether an email exists among Supabase auth users.

**Lineage:** Called by password recovery and email verification-related flows.

### `app/api/profile/check/route.ts`

**Purpose:** Reads Supabase profile data.

**Lineage:** Called by profile and onboarding UI to determine current profile state.

### `app/api/profile/delete/route.ts`

**Purpose:** Deletes the Supabase auth user and associated MongoDB profile data.

**Lineage:** Called by `app/profile/page.tsx`; cross-system account deletion endpoint.

### `app/api/profile/onboard/route.ts`

**Purpose:** Updates MongoDB `profiles` after Supabase authentication/onboarding.

**Lineage:** Called by signup/profile flows; links authenticated identity to application profile data.

### `app/api/razorpay/order/route.ts`

**Purpose:** Creates Razorpay orders using configured membership pricing.

**Lineage:** Called by `components/Membership.tsx` and Mallu Mart/payment flows; uses Razorpay secret configuration and server-side pricing.

### `app/api/razorpay/verify/route.ts`

**Purpose:** Verifies Razorpay signatures and records payments, memberships, subscriptions, and football-team data.

**Lineage:** Called by client payment flows after checkout; writes Supabase records and is the trusted payment completion boundary.

### `app/api/settings/gallery/route.ts`

**Purpose:** Reads/updates MongoDB `site_settings` record `archive_gallery`.

**Lineage:** Called by admin gallery UI; data is consumed by `app/about/page.tsx`.

### `app/api/settings/slider/route.ts`

**Purpose:** Reads/updates MongoDB `site_settings` record `slider`.

**Lineage:** Called by homepage and admin slider UI; homepage consumes the returned slide configuration.

### `app/api/settings/social/route.ts`

**Purpose:** Reads/updates MongoDB `site_settings` record `social_glimpse`.

**Lineage:** Called by admin social UI and `InstagramGlimpse`.

### `app/api/team/route.ts`

**Purpose:** Reads/replaces MongoDB `team_members`.

**Lineage:** Called by admin team UI and about/team presentation.

## 9. Shared Components

### `components/Navbar.tsx`

**Purpose:** Global responsive navigation, user/admin state, profile menu, admin links, and membership entry point.

**Lineage:** Imported by `app/layout.tsx`; uses Supabase browser auth and links to public/auth/admin routes. It participates in the global membership flow through `Membership`.

### `components/Footer.tsx`

**Purpose:** Global footer with navigation, social links, admin link, and privacy/terms links.

**Lineage:** Imported by `app/layout.tsx`; links to route pages and external social destinations.

### `components/Preloader.tsx`

**Purpose:** Initial loading overlay using the main logo.

**Lineage:** Imported by `app/layout.tsx`; uses `/logo_main.png` and global styling.

### `components/ConditionalGate.tsx`

**Purpose:** Client-side path-based wrapper that conditionally renders `GlobalEntryGate`.

**Lineage:** Imported by `app/layout.tsx`; observes browser path/session state and decides where the entry gate appears.

### `components/GlobalEntryGate.tsx`

**Purpose:** Firebase phone OTP entry gate and Supabase profile/session linking.

**Lineage:** Rendered by `ConditionalGate`; uses `lib/firebase.ts`, Supabase browser auth, profile APIs, and alert UI.

### `components/EventCard.tsx`

**Purpose:** Reusable event display with media, date, location, map, and ticket links.

**Lineage:** Used by homepage and public events listing. Consumes event objects from `/api/events`; falls back to public placeholder media where needed.

### `components/EventGlimpse.tsx`

**Purpose:** Event preview grid/component.

**Lineage:** No active static import was found in the audit. It may be legacy, dynamically referenced, or reserved for future use.

### `components/Membership.tsx`

**Purpose:** Membership purchase flow using Razorpay order/verification endpoints and `TribeCalendar`.

**Lineage:** Opened from `Navbar` and used in membership/about contexts; calls `/api/razorpay/order` and `/api/razorpay/verify`.

### `components/about/InstagramGlimpse.tsx`

**Purpose:** Instagram-style image/video card grid driven by social settings.

**Lineage:** Used by `app/about/page.tsx`; fetches `/api/settings/social`; displays dynamic URLs and public fallback/media assets.

### `components/JammingSection.tsx`

**Purpose:** Animated music/jamming promotional section.

**Lineage:** Used by page-level promotional layouts, especially homepage/about-related content where imported; uses video/image media and global CSS animation rules.

### `components/Popup.tsx`

**Purpose:** Fetches the active collaboration advertisement and displays it.

**Lineage:** Used by `app/page.tsx`; calls `/api/admin/popup` or the active-popup read path and displays database/storage-backed ad media.

### `components/ChatWidget.tsx`

**Purpose:** Chat widget implementation scaffold.

**Lineage:** The implementation is fully commented out and no active static consumer was found. It currently has no runtime effect.

### `components/EmailVerificationGate.tsx`

**Purpose:** Email verification workflow for community and Mallu Mart forms.

**Lineage:** Used by community and directory listing forms; coordinates verification APIs, user input, and gate state before mutation.

### `components/MartVerificationModal.tsx`

**Purpose:** Modal for uploading business verification documents.

**Lineage:** Used by Mallu Mart detail/admin flows; submits documents through `/api/mart` and the `mallu-mart` Storage bucket.

### `components/MartInvoiceGate.tsx`

**Purpose:** Gates Mallu Mart listing actions behind invoice/subscription state.

**Lineage:** Used by directory listing detail/action flows; relates user profile, payment, membership/subscription, and verification state.

### `components/NodeDetails.tsx`

**Purpose:** Full community detail/member/photo/service/map view.

**Lineage:** Imported by `app/community/[id]/page.tsx`; consumes community route data and renders contact/map/WhatsApp actions.

### `components/TribeAlert.tsx`

**Purpose:** Animated alert presentation.

**Lineage:** Rendered by `context/AlertContext.tsx`; receives global alert state and is indirectly available to pages/components using `useAlert`.

### `components/TribeConfirm.tsx`

**Purpose:** Reusable confirmation modal for destructive or consequential actions.

**Lineage:** Used by pages/components that need confirmation, including account/content management flows where statically imported.

### `components/TribeDisclaimer.tsx`

**Purpose:** Community/Mallu Mart disclaimer UI.

**Lineage:** Used by relevant directory/community forms and detail flows where imported; provides shared disclosure text and presentation.

### `components/TicketServiceTable.tsx`

**Purpose:** Ticket/service table presentation component.

**Lineage:** No active static usage was found in the audit. It may be legacy or reserved for event/service detail views.

### `components/SectionDivider.tsx`

**Purpose:** Decorative section divider.

**Lineage:** No active static usage was found in the audit.

### `components/ui/TribeCalendar.tsx`

**Purpose:** Custom date picker.

**Lineage:** Used by signup, profile, membership, and admin event forms. It is a shared controlled input with no direct database responsibility.

### `components/ui/TribeTimePicker.tsx`

**Purpose:** Custom time picker.

**Lineage:** Used by community and event forms, including public/admin create/edit screens.

### `components/ui/WhatsappTribe.tsx`

**Purpose:** Reusable WhatsApp community CTA.

**Lineage:** Imported globally by `app/layout.tsx` and also used on community-related pages. Generates external WhatsApp navigation from supplied label/phone configuration.

### `components/admin/AddAdminCard.tsx`

**Purpose:** Admin creation form/card.

**Lineage:** Used by admin dashboard/member pages; calls `/api/admin/create` and uses alert state.

### `components/admin/MemberActivityList.tsx`

**Purpose:** Displays administrator/member activity and supports admin access revocation.

**Lineage:** Used by `app/admin/members/page.tsx`; invokes the `revokeAdminAccess` server action from `app/admin/action.ts`.

## 10. Context, Libraries, and Model

### `context/AlertContext.tsx`

**Purpose:** Global alert provider and `useAlert` hook.

**Lineage:** `AlertProvider` wraps the application in `app/layout.tsx`; child pages/components call `useAlert`; it renders `components/TribeAlert.tsx`.

### `lib/admin.ts`

**Purpose:** Server-side admin-access check against Supabase `authorized_admins`.

**Lineage:** Used by `app/admin/layout.tsx`, admin API routes, and server-side admin mutations. It is a central authorization helper.

### `lib/database-actions.ts`

**Purpose:** Database action placeholder.

**Lineage:** Currently empty; no active behavior or confirmed consumers.

### `lib/firebase.ts`

**Purpose:** Initializes Firebase and exports browser `auth`.

**Lineage:** Used by `GlobalEntryGate`, signup, profile, and other phone-auth client flows. Configuration comes from public Firebase environment variables.

### `lib/mail.ts`

**Purpose:** Nodemailer transporter and email functions for community, Mallu Mart, admin access, verification, and receipts.

**Lineage:** Called by contact, community, Mallu Mart, admin, and payment API routes. Uses `EMAIL_USER`/`EMAIL_PASS` and an external SMTP/Gmail service.

### `lib/mongodb.ts`

**Purpose:** Validates `MONGODB_URI`, exports a cached MongoDB client promise, and provides Mongoose `dbConnect`.

**Lineage:** Imported by MongoDB-backed API routes and `models/SupportTicket.ts`; controls server-side MongoDB connection reuse.

### `lib/pricing-config.ts`

**Purpose:** Pricing configuration placeholder.

**Lineage:** Currently empty; payment routes use their active pricing logic/configuration elsewhere.

### `lib/supabase.ts`

**Purpose:** Supabase library placeholder.

**Lineage:** Currently empty. Active Supabase client/server helpers are defined or imported through other project files/dependencies.

### `models/SupportTicket.ts`

**Purpose:** Mongoose schema/model for contact/support tickets: name, email, subject, message, status, and creation time.

**Lineage:** Used by `app/api/contact/route.ts` for creation and `app/api/admin/support/route.ts` for administration; depends on `lib/mongodb.ts` connection setup.

## 11. Public Assets

Public assets are served from the site root by Next.js. Their lineage is usually through string paths such as `/about/...`, `/events/...`, `/founders/...`, or `/videos/...`, rather than TypeScript imports. Dynamic CMS URLs may refer to Supabase Storage instead.

### Root public assets

- `public/logo_main.png` — Global logo used by `Preloader` and other shared/page UI.
- `public/hero-bg.jpeg` — No direct static source usage found; possible legacy or externally referenced hero asset.
- `public/file.svg` — No direct static source usage found; likely starter/legacy asset.
- `public/globe.svg` — No direct static source usage found; likely starter/legacy asset.
- `public/window.svg` — No direct static source usage found; likely starter/legacy asset.
- `public/next.svg` — No direct static source usage found; likely starter/legacy asset.
- `public/vercel.svg` — No direct static source usage found; likely starter/legacy asset.

### `public/about/`

- `public/about/placeholder.jpeg` — Default fallback image used across listings/events.
- `public/about/image_1.jpeg` — Jamming/promotional imagery used by page-level promotional sections.
- `public/about/community.jpeg` — About-page community imagery.
- `public/about/beauty.jpeg` — About-page/video imagery.
- `public/about/agams.jpg` — About/event imagery.

### `public/events/`

- `public/events/about5.png` — About-page background.
- `public/events/agams.jpg` — Event imagery.
- `public/events/comm_2.png` — Community detail background.
- `public/events/contact2.webp` — Contact-page background.
- `public/events/eventsback.jpg` — Homepage/events background.
- `public/events/footback.png` — Football-related imagery; no direct static usage found in scanned source.
- `public/events/image_2.jpeg` — Event imagery; no direct static usage found in scanned source.
- `public/events/image_3.jpeg` — Event imagery; no direct static usage found in scanned source.
- `public/events/login.jpg` — Login background.
- `public/events/main2.jpeg` — Events-page background.
- `public/events/main4.jpg` — Event imagery; no direct static usage found in scanned source.
- `public/events/mmart.webp` — Mallu Mart background.
- `public/events/partner_3.png` — Partner-page background.

### `public/founders/`

- `public/founders/suchi.jpg` — Founder profile image used on homepage/about content.
- `public/founders/shehanas_2.jpeg` — Founder profile image used on homepage/about content.

### `public/videos/`

- `public/videos/agam-recap.mp4` — Homepage recap video.
- `public/videos/beauty.mp4` — About promotional video.
- `public/videos/hero-video.mp4` — No direct static usage found; possible legacy or upload asset.
- `public/videos/jam.mp4` — Homepage/about jamming video.

## 12. Data and Environment Dependencies

Expected environment variables observed from the source include:

- `MONGODB_URI`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `EMAIL_USER`
- `EMAIL_PASS`
- `NEXT_PUBLIC_SITE_URL`
- `NEXT_PUBLIC_RAZORPAY_KEY_ID`
- `RAZORPAY_KEY_SECRET`
- Firebase client configuration variables used by `lib/firebase.ts`

Observed MongoDB collections include `events`, `community_circles`, `mallu_mart`, `partners`, `team_members`, `site_settings`, `profiles`, and popup/ad data. Observed Supabase tables include profiles, memberships, payments, football registration/team data, `authorized_admins`, `admin_audit_logs`, `directory_owners`, and `app_settings`. Storage buckets include `assets`, `events`, `community`, `partners`, `ads`, and `mallu-mart`.

## 13. Static-Analysis Limits and Unresolved Lineage

- Database document contents, complete schemas, indexes, policies, RLS behavior, and actual records require runtime/database inspection.
- Dynamic media and links returned by slider, gallery, social, popup, community, event, partner, and Mallu Mart APIs cannot be mapped to a specific file statically.
- Runtime `slide.buttonLink`, ticket URLs, map links, websites, Instagram handles, and database-provided navigation are data-dependent.
- `EventGlimpse`, `SectionDivider`, `TicketServiceTable`, and `ChatWidget` have no confirmed active static consumers; `ChatWidget` is commented out.
- `hero-bg.jpeg`, starter SVGs, several event images, `hero-video.mp4`, and `footback.png` have no confirmed static source consumers and may be legacy, externally referenced, or CMS-related.
- `.next/` is generated build output and `node_modules/` is installed dependency content, so neither is documented file by file. Their source-level entry points are documented through `next-env.d.ts`, `package.json`, and the configuration files above.
- Both PostCSS config files exist. Which one is selected depends on tooling/config resolution and should be verified during a build if CSS behavior is unexpected.
