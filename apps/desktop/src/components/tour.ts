/**
 * The guided tour: one real control per stop, on the page it lives on.
 *
 * Deliberately short. A tour that explains every button is read by nobody, so
 * this covers only the controls someone has to find to get a first job costed,
 * printed and paid for — in the order they would need them.
 *
 * `target` is a `data-tour` value on a real element. If it is missing — hidden
 * by role, or a screen that has not loaded — the stop still shows, without a
 * spotlight, rather than the tour dead-ending.
 */

export interface TourStop {
  id: string;
  route: string;
  /** `data-tour` attribute of the element to point at. */
  target?: string;
  title: string;
  text: string;
}

export const TOUR: TourStop[] = [
  {
    id: 'nav',
    route: '/',
    target: 'nav',
    title: 'Everything lives here',
    text: 'Sections open when you click them. We will walk the ones that matter '
        + 'for getting a first job costed, printed and paid for.',
  },
  {
    id: 'rates',
    route: '/settings/cost-profiles',
    target: 'cost-profile-new',
    title: 'Set your rates first',
    text: 'Electricity, labour and machine cost per hour. Left at zero, every job '
        + 'looks far more profitable than it really is.',
  },
  {
    id: 'filament',
    route: '/inventory/filaments',
    target: 'filament-new',
    title: 'One entry per filament you buy',
    text: 'Brand, material and colour. Set a warning and critical weight here too, '
        + 'or the app has no way to know what "low" means for you.',
  },
  {
    id: 'spool',
    route: '/inventory/spools',
    target: 'spool-new',
    title: 'One spool per physical reel',
    text: 'Enter shipping and tax alongside the price. Cost per gram comes from '
        + 'the total you actually paid to get it on the shelf.',
  },
  {
    id: 'upload',
    route: '/models/upload',
    target: 'model-drop',
    title: 'Drop a model here',
    text: 'STL or 3MF. It gets the next product code (C0001…), which orders are '
        + 'taken by. Weight and time come later, from slicing the job.',
  },
  {
    id: 'job',
    route: '/production/queue',
    target: 'job-new',
    title: 'Queue a print job',
    text: 'Pick the model, the printer, and a spool for every colour. It slices '
        + 'as you go: the weight and time you see are measured, never guessed.',
  },
  {
    id: 'order',
    route: '/sales/orders',
    target: 'order-new',
    title: 'Take an order',
    text: 'Type a product code on each line: a library model, or a custom design '
        + 'and which build. Use Payment when money arrives.',
  },
  {
    id: 'expense',
    route: '/finance/expenses',
    target: 'finance-new',
    title: 'Record what you spend',
    text: 'Payments post their own income for you; expenses you enter here. '
        + 'Filament, electricity, packaging, rent.',
  },
  {
    id: 'lowstock',
    route: '/inventory/low-stock',
    target: 'lowstock-summary',
    title: 'Let it tell you what to buy',
    text: 'From your own consumption, supplier lead time and safety stock: how '
        + 'much to order, and by when.',
  },
  {
    id: 'reopen',
    route: '/',
    target: 'guide-button',
    title: 'That is the tour',
    text: 'Reopen it any time from this button.',
  },
];
