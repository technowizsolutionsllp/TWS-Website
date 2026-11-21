import { notFound, redirect } from 'next/navigation';
import { latestPaths } from '../../latest';
import { getLegalVersion, legalVersions } from '../../versions';

type Params = { version: string };

export const dynamicParams = false;

export function generateStaticParams(): Params[] {
  return Object.keys(legalVersions.privacy).map((version) => ({ version }));
}

// Old versioned addresses are kept only so existing links still work: they go to the latest text.
export default async function Page({ params }: { params: Promise<Params> }) {
  const { version } = await params;
  if (!getLegalVersion('privacy', version)) notFound();
  redirect(latestPaths.privacy);
}
