import { ContractVisualizer } from '@/components/contract-visualizer';

export default function Home() {
  return (
    <main className="min-h-screen p-8">
      <h1 className="text-3xl font-bold mb-8">Protocol Visualizer</h1>
      <ContractVisualizer />
    </main>
  );
}
