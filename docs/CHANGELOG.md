# Changelog

All notable changes to Lionade, newest first.

---

## 2026-03-29
- `c3f7fa6` — docs: reorganize CLAUDE_AGENT.md into clean sections

## 2026-03-22
- `cc9631f` — fix: remove eye overlays from lion mascot
- `3b81846` — fix: resolve hooks violation on games page
- `4b4a873` — design: new transparent lion image and larger game cards
- `038f97d` — design: diagonal lion-centered games page with electric card animations
- `e842982` — design: animated cursor-tracking lion and games page redesign
- `5cd2924` — fix: permanent solution for white screen crashes on new pages
- `8c4c214` — feat: Games tab with Roardle, Blitz Sprint, Flash Cards, Timeline Drop and PDF upload
- `3a868d3` — fix: resolve hydration crashes and add error boundaries
- `23fc324` — fix: restore interstellar background after overscroll fix
- `2a39ed6` — fix: permanently hide savanna and fix /home page in light mode
- `7b6503d` — fix: restore sakura for light mode, fix /home page blank screen
- `0f2b787` — fix: restore finger scrolling while keeping overscroll background
- `0824387` — fix: hide savanna background that bleeds through in light mode
- `b2f50eb` — docs: add theme requirements to CLAUDE_AGENT.md
- `ec452be` — fix: remove overscroll blank space globally
- `34ff36e` — design: wave color animation on Duel Arena title

## 2026-03-20
- `2f7c982` — fix: resolve white screen crash when navigating between pages
- `de288d6` — feat: real-time notifications system with bell icon
- `2d7ac6a` — feat: live username search for adding friends
- `24378e8` — feat: social tab with friends and messaging
- `1df9eec` — fix: use CSS class for layout background instead of inline style
- `f34bfaa` — fix: add background to layout content wrapper for light mode
- `ce53f94` — fix: restore arena page after broken animation
- `f26ef3f` — design: subtle glint animation on Duel Arena title
- `642682a` — fix: force dark background on all arena phases for light mode
- `b10b3b9` — design: arena title shimmer every 20 seconds
- `1f01099` — design: red shimmer effect on Duel Arena title
- `6b23bec` — design: animated flashing title for Duel Arena
- `6128f6c` — design: premium arena page redesign
- `afbd3d4` — fix: restore compete page after arena build
- `d21e0e7` — feat: build full 1v1 Duel Arena with real-time competitive battles

## 2026-03-19
- `96af087` — fix: force logout if inactive for 2+ hours across sessions

## 2026-03-17
- `72b6ab3` — feat: GitHub Actions auto question generation
- `bcb8ea1` — feat: auto logout after 2 hours of inactivity

## 2026-03-14
- `a051fc8` — chore: reorganize question files into subject folders
- `f0f0db4` — feat: seed science questions into Supabase
- `767f7dc` — fix: prevent existing users from being redirected to onboarding
- `9e7952c` — fix: remove radial gradient blobs from home page background
- `473122e` — fix: force gold headings and light text on coming soon page
- `21ddb72` — fix: standardize all text colors on coming soon page
- `35af4bd` — fix: dark navbar, white text headings, dark sub-cards
- `11ecc46` — fix: force dark cards on coming soon page
- `72c84e4` — fix: skip onboarding for existing users, force dark mode on pre-auth pages
- `f6928c3` — fix: replace placeholder logo with actual lion icon on login page
- `486592c` — revert: restore full marketing coming soon page
- `14e279c` — Remove auth dependency from coming soon page
- `b577975` — Fix middleware redirect loop and white background flash
- `c584f30` — Add coming-soon maintenance mode redirect

## 2026-03-11
- `dd0fe4d` — Fix TypeScript build error: wrap matchAll in Array.from
- `9405141` — Replace spring/sakura light theme with savanna theme, fix expired streak reset

## 2026-03-07
- `7654b10` — Rewrite theme system with CSS variables, remove all !important overrides
- `a1b6b08` — Add fangs.png coin icon to public assets
- `8483e38` — Make coin pill clickable and link to /wallet

## 2026-03-06
- `eac9de9` — Add light mode spring/sakura theme
- `bec5622` — Replace coin emoji with fangs.png, redesign profile dropdown, add badges/wallet/settings pages
- `51b9d67` — Add streak popup modal, 36-hour streak system, fix stat flash-of-zero
- `93c8b1d` — Fix avatar flicker on tab switch with SWR cache
- `6001eb4` — Fix tab-switching flicker by layering SWR cache over auth context
- `8720fa1` — Merge branch 'santy/personalisation'
- `a2edd98` — Fix linter-duplicated CSS and JSX in shop page
- `12cf8a8` — Rebuild shop with Coin Store / Premium Store toggle
- `b7c7d0e` — Install Stripe packages
- `005c05c` — Fix shop: remove auth redirect, handle missing DB columns
- `92b42f3` — Add database migration for shop tables
- `2998647` — Integrate boosters into quiz flow
- `061d420` — Add shop API routes: purchase, equip, activate-booster
- `9ca51d0` — Add shop CSS animations: rarity glows, tilt cards, legendary borders
- `02afbe6` — Add Lion's Den shop page and Shop nav link

## 2026-03-05
- `00eff99` — Fix streak system: quiz-count based, cap daily progress

## 2026-03-04
- `fd9a64f` — Merge PR #2 from santy/personalisation
- `7c06bac` — Redesign theme cards, update light theme to soft blue
- `dd03507` — Merge PR #1 from santy/personalization
- `6479579` — Add functional preferences: light/dark theme, font scaling, compact layout

## 2026-03-01
- `086802c` — Remove Upload tab from Avatar & Appearance
- `a0dbae6` — Add username system: unique check, one change per year

## 2026-02-28
- `0c8fc82` — Update save-quiz-results to check bounty progress and resolve daily bets
- `a227cd2` — Add Daily Bet card with stake/target picker
- `f1a4ee0` — Add Bounty Board with daily/weekly bounties and claim API
- `d0ea130` — Remove Daily Quiz card from Continue section
- `42214a7` — Skip topic-less quiz sessions in Continue section
- `6c4345b` — Replace Continue carousel with static topic cards
- `17934ae` — Replace This Week placeholder with real leaderboard data
- `d692b90` — Show best score per subject in Your Subjects cards
- `f3a5a4b` — Show achievements grid on dashboard
- `36c4f81` — Add achievement system — check and award after each quiz
- `690b679` — Animate XP bar with blue-purple gradient
- `5508819` — Add streak fire animation with motivational banner
- `c6b0554` — Add daily progress bar showing questions answered
- `9cb226f` — Fix Recent Activity to show quiz sessions with scores
- `b4a0eeb` — Add coin burst animation on quiz results screen
- `42dc7c1` — Fix quiz_sessions FK constraint
- `6fe78a4` — Add SQL migration for missing gamification columns

## 2026-02-27
- `8d74cee` — Add server-side API route for quiz results to bypass RLS
- `6a71c85` — Fix refreshUser overwriting stats
- `175fc83` — Fix stats not updating: auth context was hardcoding coins/xp/streak to 0
- `60ee91d` — Redesign quiz results screen with glassmorphism
- `38b3089` — Wire quiz to real Supabase questions with anti-cheat
- `a4bf65b` — Remove all mock/hardcoded data, wire to real DB
- `412d32e` — Add question import script and import 1200 questions

## 2026-02-25
- `784b0b8` — Add enhanced deep space background
- `52740e1` — Apply global space/interstellar background
- `a2bb810` — Add global space background across all pages
- `9f64e37` — Redesign prize pool banner
- `6ba16ce` — Widen main content containers to max-w-7xl
- `ec27864` — Move community help note from /about to /contact
- `4848891` — Update /about page with full content
- `b3b7b40` — Replace gem sweep shimmer with breathing glow
- `99082d3` — Add gemstone images to ranking tier pyramid
- `c2a20b4` — Update ranking tier subtitles to academic theme
- `722d0b3` — Add logo image files
- `1351f50` — Add privacy, terms, and contact pages
- `fcf2695` — Add /about page, global footer
- `33357ff` — Add difficulty selector cards and answer explanations
- `1f352dc` — Fix demo timer auto-advance
- `12262cf` — Replace demo page logo with lion icon + animated text
- `5e8bf91` — Fix demo page content overlapping navbar
- `2709c13` — Add subtle glow and shimmer to navbar logo
- `63ee389` — Replace text logo with image logos in navbar

## 2026-02-24
- `936a0c7` — Fix auth persistence, onboarding redirect, profile self-heal
- `adb89bd` — Add onboarding flow, fix auth redirect, overhaul compete page

## 2026-02-23
- `e9f2e26` — Add category-based quiz selection with 8 topics

## 2026-02-22
- `4a778d4` — Redesign coming soon page

## 2026-02-21
- `c0d0916` — Redesign dashboard with circular stats and carousel
- `454a41b` — Redesign coming soon page with 3D visuals
- `b38a60b` — Coming soon landing page + gated product page + auth redirect
- `1f94bcb` — Add waitlist flow

## 2026-02-20
- `5043325` — Fix: remove duplicate CSP headers from next.config.js
- `12a6733` — UI + features pass: Dashboard, Learn with Ninny, Compete with rank strip
- `31000c9` — Nav + UI cleanup: slim nav, 3 tabs, avatar dropdown, mobile bottom nav
- `c3dc087` — Add security layers: rate limiting, sanitization, brute force, headers
- `4e13220` — Redesign profile page with sidebar layout and 8 sections
- `da9a8a6` — Improve signup and auth flow

## 2026-02-19
- `16dec58` — Add full Next.js app — Lionade beta
- `983474c` — Add hidden DevOps access to coming soon page

## 2026-02-18
- `c92bb6a` — Initial upload
