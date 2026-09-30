// Starting points for the Email Studio. Pure data, safe for client components.

export interface CampaignContent {
  subject: string;
  preheader: string;
  heading: string;
  body: string;
  ctaLabel: string;
  ctaUrl: string;
  footerNote: string;
}

export const MERGE_TAGS = [
  { tag: '{{name}}', hint: "Recipient's name (falls back to 'there')" },
  { tag: '{{email}}', hint: "Recipient's email address" },
] as const;

export const EMPTY_CAMPAIGN: CampaignContent = {
  subject: '',
  preheader: '',
  heading: '',
  body: '',
  ctaLabel: '',
  ctaUrl: '',
  footerNote: '',
};

export const CAMPAIGN_TEMPLATES: { id: string; label: string; content: CampaignContent }[] = [
  {
    id: 'blank',
    label: 'Blank',
    content: EMPTY_CAMPAIGN,
  },
  {
    id: 'announcement',
    label: 'Announcement',
    content: {
      subject: 'News from Puneri Mallus',
      preheader: 'A quick update from the Tribe',
      heading: 'A quick update for you',
      body: "Hi {{name}},\n\nWe have some news to share with the Tribe.\n\nWrite your update here. Keep it short: two or three small paragraphs read best.\n\nThank you for being part of Puneri Mallus.",
      ctaLabel: 'Read more',
      ctaUrl: 'https://punerimallus.com',
      footerNote: '',
    },
  },
  {
    id: 'event-invite',
    label: 'Event invite',
    content: {
      subject: "You're invited: {{event name}}",
      preheader: 'Passes are open now',
      heading: "You're invited",
      body: "Hi {{name}},\n\nWe're happy to invite you to our next event.\n\n**When:** add the date and time\n**Where:** add the venue\n\nPasses are limited, so book early.",
      ctaLabel: 'Book your passes',
      ctaUrl: 'https://punerimallus.com/events',
      footerNote: '',
    },
  },
  {
    id: 'event-reminder',
    label: 'Event reminder',
    content: {
      subject: 'Reminder: see you tomorrow',
      preheader: 'Your passes are in your email',
      heading: 'See you tomorrow',
      body: "Hi {{name}},\n\nA quick reminder that our event is tomorrow.\n\nPlease keep your pass ready on your phone (the PDF we emailed you). Gates open at add time.\n\nWe can't wait to see you there.",
      ctaLabel: 'View event details',
      ctaUrl: 'https://punerimallus.com/events',
      footerNote: '',
    },
  },
  {
    id: 'thank-you',
    label: 'Thank you',
    content: {
      subject: 'Thank you for joining us',
      preheader: 'It meant a lot to have you there',
      heading: 'Thank you',
      body: "Hi {{name}},\n\nThank you for being part of our last event. It meant a lot to have you with us.\n\nWe'd love to hear what you liked and what we can do better. Just reply to this email.",
      ctaLabel: 'See photos and highlights',
      ctaUrl: 'https://punerimallus.com/about',
      footerNote: '',
    },
  },
  {
    id: 'membership',
    label: 'Membership',
    content: {
      subject: 'Join the Puneri Mallus Tribe',
      preheader: 'Lifetime membership with real benefits',
      heading: 'Become a lifetime member',
      body: "Hi {{name}},\n\nOur lifetime membership gives you:\n\n**Premium badge** on your profile\n**Free access** to all directory listings\n**Event invitations** and discounts\n\nJoin once, stay a member for life.",
      ctaLabel: 'Become a member',
      ctaUrl: 'https://punerimallus.com',
      footerNote: '',
    },
  },
];
