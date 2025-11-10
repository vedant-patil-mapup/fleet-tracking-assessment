import { useState } from 'react'
import reactLogo from './assets/react.svg'
import viteLogo from '/vite.svg'
import './App.css'
import FleetDashboard from "./FleetDashboard";

function App() {
  const [count, setCount] = useState(0)

  return (
    <>
 <FleetDashboard />

    </>
  )
}

export default App
