import { ContractVisualizer } from "./components/contract-visualizer";

function App() {
  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold mb-8">Protocol Visualizer</h1>
        <ContractVisualizer />
      </div>
    </div>
  );
}

export default App;
