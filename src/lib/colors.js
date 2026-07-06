// MLC Platform — Global colour palette (light theme)
// Import this in any component: import { C, STATUS_COLORS, JOB_STATUS_COLORS } from '../lib/colors'

export const C = {
  // Backgrounds
  bg:         '#FFFFFF',   // pure white
  surface:    '#F5F7FA',   // very light grey for cards
  surface2:   '#EAECF0',   // slightly darker for headers inside cards
  border:     '#E5E7EB',   // soft border

  // MLC Brand
  accent:     '#0093DB',   // Compliance Blue
  accentSoft: '#E6F4FC',   // light blue tint for backgrounds
  accentDark: '#0077b3',   // darker blue for hover

  // Action Green
  green:      '#80D100',
  greenSoft:  '#F0FAE0',
  greenDark:  '#5a9400',

  // Status colours — light theme versions
  amber:      '#D97706',
  amberSoft:  '#FEF3C7',
  red:        '#DC2626',
  redSoft:    '#FEE2E2',
  purple:     '#7C3AED',
  purpleSoft: '#EDE9FE',
  teal:       '#0D9488',
  tealSoft:   '#CCFBF1',
  sky:        '#0284C7',
  skySoft:    '#E0F2FE',

  // Text — Charcoal
  text:       '#1F2937',
  muted:      '#6B7280',
  dim:        '#9CA3AF',

  // Sidebar
  sidebarBg:  '#1F2937',   // Charcoal sidebar
  sidebarText: '#F9FAFB',
  sidebarMuted: '#9CA3AF',
}

// Job status definitions for light theme
export const JOB_STATUSES = [
  { key: 'Quote',       color: '#7C3AED', bg: '#EDE9FE', border: '#7C3AED33', icon: '📋' },
  { key: 'Scheduled',   color: '#0284C7', bg: '#E0F2FE', border: '#0284C733', icon: '📅' },
  { key: 'In Progress', color: '#D97706', bg: '#FEF3C7', border: '#D9770633', icon: '🔧' },
  { key: 'Completed',   color: '#0D9488', bg: '#CCFBF1', border: '#0D948833', icon: '✅' },
  { key: 'Invoiced',    color: '#0093DB', bg: '#E6F4FC', border: '#0093DB33', icon: '🧾' },
  { key: 'Paid',        color: '#5a9400', bg: '#F0FAE0', border: '#80D10033', icon: '💰' },
  { key: 'Cancelled',   color: '#DC2626', bg: '#FEE2E2', border: '#DC262633', icon: '✕'  },
]

export const STATUS_MAP = Object.fromEntries(JOB_STATUSES.map(s => [s.key, s]))

// Client status colours
export const CLIENT_STATUS_COLORS = {
  'New':           { color: '#6B7280', bg: '#F3F4F6' },
  'Contacted':     { color: '#D97706', bg: '#FEF3C7' },
  'Qualified':     { color: '#7C3AED', bg: '#EDE9FE' },
  'Proposal Sent': { color: '#0284C7', bg: '#E0F2FE' },
  'Active Client': { color: '#5a9400', bg: '#F0FAE0' },
  'Closed Won':    { color: '#5a9400', bg: '#F0FAE0' },
  'Closed Lost':   { color: '#DC2626', bg: '#FEE2E2' },
  'Unsubscribed':  { color: '#9CA3AF', bg: '#F3F4F6' },
}

// Client type colours
export const TYPE_COLORS = {
  inbound:    { color: '#5a9400', bg: '#F0FAE0', label: 'Inbound' },
  verified:   { color: '#0093DB', bg: '#E6F4FC', label: 'Verified' },
  cold_agent: { color: '#D97706', bg: '#FEF3C7', label: 'Cold Agent' },
}
