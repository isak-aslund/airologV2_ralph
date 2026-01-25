import { BrowserRouter, Routes, Route, Link } from 'react-router-dom'
import LogListPage from './pages/LogListPage'
import UploadPage from './pages/UploadPage'
import './App.css'

function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-gray-50">
        <header className="bg-white shadow-sm border-b border-gray-200">
          <div className="container mx-auto px-4 py-3 sm:py-4 flex items-center justify-between gap-2">
            <Link to="/" className="text-lg sm:text-xl font-bold text-gray-900 hover:text-gray-700 truncate">
              Flight Log Manager
            </Link>
            <nav className="flex items-center gap-2 sm:gap-4 flex-shrink-0">
              <Link
                to="/"
                className="text-gray-600 hover:text-gray-900 font-medium text-sm sm:text-base"
              >
                Logs
              </Link>
              <Link
                to="/upload"
                className="bg-blue-600 text-white px-3 py-1.5 sm:px-4 sm:py-2 rounded-md hover:bg-blue-700 font-medium text-sm sm:text-base"
              >
                Upload
              </Link>
            </nav>
          </div>
        </header>
        <main>
          <Routes>
            <Route path="/" element={<LogListPage />} />
            <Route path="/upload" element={<UploadPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}

export default App
