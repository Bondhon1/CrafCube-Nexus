/**
 * The user guide's content, kept apart from its chrome so the writing can be
 * edited without touching the navigation.
 *
 * Written to explain the rules the system enforces, not to narrate the
 * buttons. Someone who reads this should understand *why* a job will not
 * prepare without a spool — not just where to click.
 */

export interface GuideStep {
  id: string;
  title: string;
  /** One line under the heading; sets up what the section is for. */
  summary: string;
  body: GuideBlock[];
  /** Where in the app this section is about, if anywhere. */
  route?: string;
  routeLabel?: string;
}

export type GuideBlock =
  | { kind: 'text'; text: string }
  | { kind: 'steps'; items: string[] }
  | { kind: 'points'; items: { term: string; detail: string }[] }
  | { kind: 'rule'; text: string };

export const GUIDE: GuideStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to CrafCube Nexus',
    summary: 'What this is, and the one idea the whole system is built on.',
    body: [
      {
        kind: 'text',
        text: 'This is a business system for a 3D-printing shop. It tracks what you '
            + 'own, what you print, what it truly costs, and what you actually earn.',
      },
      {
        kind: 'rule',
        text: 'Price is not revenue. Revenue is not cost. Cost is not cash. '
            + 'Confusing those four is how a busy shop runs out of money, so this app '
            + 'keeps them in separate columns everywhere they appear.',
      },
      {
        kind: 'points',
        items: [
          { term: 'Price', detail: 'what the customer agreed to pay.' },
          { term: 'Revenue', detail: 'money that has actually arrived.' },
          { term: 'Cost', detail: 'what the goods cost you to make.' },
          { term: 'Cash', detail: 'payments received, and when.' },
        ],
      },
      {
        kind: 'text',
        text: 'Wherever the app cannot honestly answer something, it shows a dash '
            + 'instead of a zero. A dash means "not enough information", which is a '
            + 'different claim from "nothing".',
      },
    ],
  },
  {
    id: 'setup',
    title: 'Set up first',
    summary: 'Five things to enter before anything else will be accurate.',
    body: [
      {
        kind: 'steps',
        items: [
          'Add your printers, with their purchase cost and purchase date — '
          + 'utilisation and payback are measured against those.',
          'Add filament: a brand, a product for each colour, then a spool for each '
          + 'physical reel you own.',
          'Enter each spool\'s landed cost: what you paid, plus shipping, tax and '
          + 'anything else it took to get it onto your shelf.',
          'Open Settings → Cost profiles and set your electricity rate, labour rate '
          + 'and machine hourly cost. Leaving these at zero makes every job look '
          + 'more profitable than it is.',
          'Open Finance and seed the categories, so income and expenses have '
          + 'somewhere to go.',
        ],
      },
      {
        kind: 'rule',
        text: 'Cost profiles are the one step people skip. Material alone is usually '
            + 'less than half the true cost of a print.',
      },
    ],
    route: '/settings/cost-profiles',
    routeLabel: 'Open cost profiles',
  },
  {
    id: 'inventory',
    title: 'Filament and stock',
    summary: 'Every gram is accounted for by a ledger, never by typing a new number.',
    body: [
      {
        kind: 'text',
        text: 'A spool\'s remaining weight is never edited directly. It is calculated '
            + 'from its transactions — purchases, reservations, consumption, waste — so '
            + 'any figure can always be explained.',
      },
      {
        kind: 'points',
        items: [
          { term: 'Reservation', detail: 'material committed to a job that has not printed yet.' },
          { term: 'Consumption', detail: 'material that became a finished product.' },
          { term: 'Waste', detail: 'material lost to a failed print. Deducted from stock but kept out of unit cost, so failures do not quietly inflate what you charge.' },
        ],
      },
      {
        kind: 'text',
        text: 'Set a warning and critical threshold per filament. Without them the app '
            + 'reports "no threshold" rather than assuming you are fine — it has no way '
            + 'to know what "enough" means for your shop.',
      },
    ],
    route: '/inventory/spools',
    routeLabel: 'Open spools',
  },
  {
    id: 'models',
    title: 'Models and estimates',
    summary: 'Upload a file and let the app measure it rather than guessing.',
    body: [
      {
        kind: 'steps',
        items: [
          'Upload an STL or 3MF. The app reads its geometry, renders a preview and '
          + 'detects how many colours it uses.',
          'Press Slice for a costing-grade estimate. This runs a real slicer and '
          + 'reads the G-code it produces.',
          'Check the confidence badge. HIGH means the slicer and an independent '
          + 'recount of the G-code agree; anything less tells you why they do not.',
        ],
      },
      {
        kind: 'text',
        text: 'A file containing several objects is re-arranged onto as many build '
            + 'plates as it needs, and the estimate covers all of them. The plate count '
            + 'is shown, because printing four parts across two plates really does take '
            + 'two prints.',
      },
      {
        kind: 'rule',
        text: 'A geometry estimate is never presented as a slice. If the slicer is '
            + 'unavailable the figure is marked lower-confidence instead of being '
            + 'passed off as measured.',
      },
    ],
    route: '/models/upload',
    routeLabel: 'Upload a model',
  },
  {
    id: 'costing',
    title: 'Costing and pricing',
    summary: 'What a print really costs, before any margin is added.',
    body: [
      {
        kind: 'points',
        items: [
          { term: 'Material', detail: 'grams x the spool\'s landed cost per gram.' },
          { term: 'Electricity', detail: 'printer wattage x hours x your unit rate.' },
          { term: 'Machine', detail: 'hourly cost that pays the printer back over its life.' },
          { term: 'Labour', detail: 'your setup, removal and finishing time.' },
          { term: 'Failure reserve', detail: 'a share added because some prints fail. Charging as if none do means the failures come out of your profit.' },
        ],
      },
      {
        kind: 'text',
        text: 'A price is then derived from that true cost and your target margin. '
            + 'Every quote is frozen: the rates it used are stored on it, so a later '
            + 'price change never rewrites what an old job was worth.',
      },
    ],
    route: '/settings/pricing',
    routeLabel: 'Open pricing rules',
  },
  {
    id: 'production',
    title: 'Running a print job',
    summary: 'The job board and the stock ledger are the same thing.',
    body: [
      {
        kind: 'steps',
        items: [
          'Create a job, choose the model and printer, and assign a spool to every '
          + 'colour it uses.',
          'Move it to Preparing. This reserves the estimated material.',
          'Move it to Printing when the machine starts.',
          'Complete it and enter the weight you actually measured. That becomes '
          + 'consumption, and the reservation is released.',
          'If it fails, record it as failed with a reason. The material is deducted '
          + 'as waste and the reason feeds failure analytics.',
        ],
      },
      {
        kind: 'rule',
        text: 'A job with no spool assigned cannot be prepared. It would reserve '
            + 'nothing and consume nothing, so its material would never reach the '
            + 'ledger — and stock would silently drift from reality.',
      },
      {
        kind: 'text',
        text: 'Always record a failure reason. Failure analytics is only as useful as '
            + 'the reasons you enter, and "Unrecorded" tells you nothing.',
      },
    ],
    route: '/production/queue',
    routeLabel: 'Open the queue',
  },
  {
    id: 'sales',
    title: 'Customers, orders and payments',
    summary: 'An order is a promise; a payment is money.',
    body: [
      {
        kind: 'steps',
        items: [
          'Add the customer, then create an order with a line for each item.',
          'Link a line to a product where you can — that is what makes product '
          + 'profitability work.',
          'Advance the order as it progresses: Confirmed, In production, Ready, '
          + 'Delivered.',
          'Record a payment whenever money arrives. Partial payments are normal and '
          + 'the balance is tracked for you.',
        ],
      },
      {
        kind: 'rule',
        text: 'An order total is not revenue. Revenue is recognised when you record '
            + 'a payment, which is why your revenue can sit below your order book.',
      },
      {
        kind: 'text',
        text: 'Payments and ledger entries cannot be edited or deleted. A mistake is '
            + 'corrected with a reversing entry, so financial history stays intact.',
      },
    ],
    route: '/sales/orders',
    routeLabel: 'Open orders',
  },
  {
    id: 'finance',
    title: 'Money in and out',
    summary: 'Where profit and loss actually comes from.',
    body: [
      {
        kind: 'text',
        text: 'Recording a payment writes its income line for you. Expenses you enter '
            + 'yourself — filament purchases, electricity, packaging, rent, tools.',
      },
      {
        kind: 'points',
        items: [
          { term: 'COGS categories', detail: 'costs tied to making the goods. They reduce gross profit.' },
          { term: 'Operating expenses', detail: 'everything else. They come off below gross profit.' },
        ],
      },
      {
        kind: 'text',
        text: 'Profit and loss then reads top to bottom: revenue, less cost of goods '
            + 'sold, gives gross profit; less operating expenses, gives net profit.',
      },
    ],
    route: '/finance/pnl',
    routeLabel: 'Open profit and loss',
  },
  {
    id: 'intelligence',
    title: 'Analytics and advice',
    summary: 'Everything here is advisory, and says when it does not know.',
    body: [
      {
        kind: 'points',
        items: [
          { term: 'Low stock', detail: 'turns usage, supplier lead time and safety stock into how much to order and by when.' },
          { term: 'Calibration', detail: 'shows how far your estimates have historically missed, per printer and material. It suggests a correction; it never applies one.' },
          { term: 'Print risk', detail: 'a stated heuristic over your own history, shown before you queue a job. It never blocks you.' },
          { term: 'Batching', detail: 'compares one-at-a-time against fuller plates. Fuller plates finish sooner but a failure costs the whole plate.' },
        ],
      },
      {
        kind: 'rule',
        text: 'Nothing here learns or decides. Below a few finished jobs these '
            + 'screens say "not enough data" rather than offering a number built on '
            + 'noise.',
      },
    ],
    route: '/analytics/profitability',
    routeLabel: 'Open analytics',
  },
  {
    id: 'habits',
    title: 'Habits that keep it accurate',
    summary: 'Five things worth doing every time.',
    body: [
      {
        kind: 'steps',
        items: [
          'Weigh finished prints and enter the actual weight. That is what makes '
          + 'calibration and true cost work.',
          'Always record why a print failed.',
          'Record payments as they arrive, not in a batch at month end.',
          'Enter expenses as they happen, so profit is never a surprise.',
          'Review Low stock before starting a big job, so you do not run out '
          + 'mid-print.',
        ],
      },
      {
        kind: 'text',
        text: 'You can reopen this guide at any time from the button in the sidebar.',
      },
    ],
  },
];
