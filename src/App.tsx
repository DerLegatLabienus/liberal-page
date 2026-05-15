import Header from './components/Header';
import Hero from './components/Hero';
import BillsTracker from './components/BillsTracker';
import Representatives from './components/Representatives';
import UpdatesFeed from './components/UpdatesFeed';
import PrimariesSection from './components/PrimariesSection';
import ProtocolsList from './components/ProtocolsList';
import JoinSection from './components/JoinSection';
import Footer from './components/Footer';
import './styles/globals.css';

function App() {
  return (
    <>
      <Header />
      <main>
        <Hero />
        <BillsTracker />
        <Representatives />
        <UpdatesFeed />
        <PrimariesSection />
        <ProtocolsList />
        <JoinSection />
      </main>
      <Footer />
    </>
  );
}

export default App;
