import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Home } from './pages/Home'
import { Enroll } from './pages/Enroll'
import { Verify } from './pages/Verify'
import { ExamSession } from './pages/ExamSession'
import './index.css'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/"        element={<Home />} />
        <Route path="/enroll"  element={<Enroll />} />
        <Route path="/verify"  element={<Verify />} />
        <Route path="/session" element={<ExamSession />} />
      </Routes>
    </BrowserRouter>
  )
}
