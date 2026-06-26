// Canonical education-level + study-goal option lists.
//
// Single source of truth shared by signup (app/login/page.tsx) and the profile
// editor (app/profile/page.tsx). These two screens used to define DIFFERENT
// lists, so a value written at signup (e.g. "High School Junior") matched no
// option in the profile editor and rendered as a blank select. Both screens now
// import from here so the lists can never drift again.

export const EDUCATION_LEVELS = [
  "Middle School",
  "High School Freshman",
  "High School Sophomore",
  "High School Junior",
  "High School Senior",
  "College Freshman",
  "College Sophomore",
  "College Junior",
  "College Senior",
  "Graduate Student",
  "Working Professional",
  "Self Taught / Independent Learner",
  "Other",
];

export const STUDY_GOALS = [
  "Improve my grades",
  "Prepare for SAT / ACT / GRE",
  "Study for certifications (AWS, CompTIA, etc.)",
  "Learn coding and tech skills",
  "Study for professional exams (CPA, Bar, MCAT)",
  "General knowledge and self improvement",
  "Compete and win rewards",
  "Other",
];
