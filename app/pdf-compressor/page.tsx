import { notFound } from 'next/navigation';
import { buildProductMetadata, ProductMarketingPage } from '../products/ProductMarketingPage';
import { getProduct } from '../products/data';

const product = getProduct('pdf-compressor');

export const metadata = product ? buildProductMetadata(product) : {};

export default function PdfCompressorPage() {
  if (!product) {
    notFound();
  }

  return <ProductMarketingPage product={product} />;
}
