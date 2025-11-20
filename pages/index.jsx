import dynamic from 'next/dynamic';

const ValidationPage = dynamic(() => import('../components/ValidationPage'), {
  ssr: false,
});

export default function Home() {
  return <ValidationPage />;
}
