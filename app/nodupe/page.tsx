import { notFound } from 'next/navigation';
import { buildProductMetadata, ProductMarketingPage } from '../products/ProductMarketingPage';
import { getProduct } from '../products/data';

const product = getProduct('nodupe');

export const metadata = product ? buildProductMetadata(product) : {};

export default function NoDupePage() {
  if (!product) {
    notFound();
  }

  return <ProductMarketingPage product={product} />;
}
