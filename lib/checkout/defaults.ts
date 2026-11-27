// The links built into today's app builds. They are what the site serves until a setting is saved on
// /admin/checkout (no database row yet), so turning this feature on changes nothing for buyers.
// Keep them equal to the apps' own tables (PinchPDF and NoDupe: the built-in checkout links).

import type { ProductId } from '../trial/product';
import { emptySet, type CheckoutConfig, type LinkSet, type Mode } from './config';

function standard(dodoIndividual: string, lemonIndividual: string, dodoBusiness: string, lemonBusiness: string): LinkSet {
  return {
    name: 'Standard',
    starts_at: null,
    ends_at: null,
    links: {
      dodo: [
        { type: 'individual', url: dodoIndividual },
        { type: 'business', url: dodoBusiness },
      ],
      lemon_squeezy: [
        { type: 'individual', url: lemonIndividual },
        { type: 'business', url: lemonBusiness },
      ],
    },
  };
}

const DEFAULTS: Record<ProductId, Record<Mode, CheckoutConfig>> = {
  pinchpdf: {
    live: {
      primary: 'dodo',
      force: false,
      default_set: 0,
      sets: [
        standard(
          'https://checkout.dodopayments.com/buy/pdt_0Nplqin1uobNhVKSJLImM?quantity=1',
          'https://technowizsolutions.lemonsqueezy.com/checkout/buy/584d4694-bd36-4e04-979c-2b4ffbaa3f68',
          'https://checkout.dodopayments.com/buy/pdt_0NplrzQavP5dhhEM7juVK?quantity=1',
          'https://technowizsolutions.lemonsqueezy.com/checkout/buy/ddf7f467-5c26-4551-a38e-48f990355519',
        ),
      ],
    },
    test: {
      primary: 'dodo',
      force: false,
      default_set: 0,
      sets: [
        standard(
          'https://test.checkout.dodopayments.com/buy/pdt_0NpH4a2Ken4XQYwdqsupO?quantity=1',
          'https://technowizsolutions.lemonsqueezy.com/checkout/buy/4449c474-c20f-4368-8f59-157235107996',
          'https://test.checkout.dodopayments.com/buy/pdt_0NplruuBGvxKzjtN7cqFu?quantity=1',
          'https://technowizsolutions.lemonsqueezy.com/checkout/buy/18d4738b-eaf7-405f-a4f2-24f6ab7773fb',
        ),
      ],
    },
  },
  nodupe: {
    live: {
      primary: 'lemon_squeezy',
      force: false,
      default_set: 0,
      sets: [
        standard(
          'https://checkout.dodopayments.com/buy/pdt_0Nspl8zc3NQ4lVqcDfd1V?quantity=1',
          'https://anshul.lemonsqueezy.com/checkout/buy/b4f60bd8-eb55-4235-a09e-bc1b8ffe27ec',
          'https://checkout.dodopayments.com/buy/pdt_0NspmmDgbLHobIoeUvOZC?quantity=1',
          'https://anshul.lemonsqueezy.com/checkout/buy/eece82e0-310b-40fb-8df8-b0b8b76db6f9',
        ),
      ],
    },
    // NoDupe has no sandbox checkout links yet.
    test: { primary: 'lemon_squeezy', force: false, default_set: 0, sets: [emptySet('Standard')] },
  },
};

export function defaultConfig(product: ProductId, mode: Mode): CheckoutConfig {
  return JSON.parse(JSON.stringify(DEFAULTS[product][mode])) as CheckoutConfig;
}
