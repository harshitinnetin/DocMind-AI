import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import api from '../lib/api'

const AuthContext = createContext(null)

export const AuthProvider = ({ children }) => {
  // ── Instant session mount: read from localStorage first (zero server hit) ──
  const [user, setUser] = useState(() => {
    try {
      const cached = localStorage.getItem('docmind_user')
      return cached ? JSON.parse(cached) : null
    } catch { return null }
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = localStorage.getItem('docmind_token')
    const cached = localStorage.getItem('docmind_user')

    if (token && cached) {
      // ⚡ Cache Bypass: Already have cached user + valid token → skip GET /api/auth/me
      // 0 DB queries, 0 API requests on refresh. Dashboard mounts instantly.
      // Safety net: any 401 from backend will clear cache and redirect (handled in api.js)
      setLoading(false)
      return
    }

    if (token && !cached) {
      // Token exists but no cache — fetch once to hydrate
      api.get('/auth/me')
        .then(data => {
          setUser(data.user)
          localStorage.setItem('docmind_user', JSON.stringify(data.user))
        })
        .catch(() => {
          localStorage.removeItem('docmind_token')
          localStorage.removeItem('docmind_user')
          setUser(null)
        })
        .finally(() => setLoading(false))
      return
    }

    // No token, no cache
    setLoading(false)
  }, [])

  // ── Guest mode: calls backend to create a real JWT-backed guest session ──
  const continueAsGuest = useCallback(async () => {
    const data = await api.post('/auth/guest')
    localStorage.setItem('docmind_token', data.token)
    localStorage.setItem('docmind_user', JSON.stringify(data.user))
    setUser(data.user)
    return data
  }, [])

  // ── Auth actions ──
  const login = useCallback(async (email, password) => {
    const data = await api.post('/auth/login', { email, password })
    localStorage.setItem('docmind_token', data.token)
    localStorage.setItem('docmind_user', JSON.stringify(data.user))
    setUser(data.user)
    return data
  }, [])

  const register = useCallback(async (email, password, fullName) => {
    const data = await api.post('/auth/register', { email, password, fullName })
    localStorage.setItem('docmind_token', data.token)
    localStorage.setItem('docmind_user', JSON.stringify(data.user))
    setUser(data.user)
    return data
  }, [])

  const loginWithGoogle = useCallback(async (googleData) => {
    const data = await api.post('/auth/google', googleData)
    localStorage.setItem('docmind_token', data.token)
    localStorage.setItem('docmind_user', JSON.stringify(data.user))
    setUser(data.user)
    return data
  }, [])

  const logout = useCallback(() => {
    localStorage.removeItem('docmind_token')
    localStorage.removeItem('docmind_user')
    setUser(null)
  }, [])

  const updateUser = useCallback((updates) => {
    const updated = { ...user, ...updates }
    setUser(updated)
    localStorage.setItem('docmind_user', JSON.stringify(updated))
  }, [user])

  return (
    <AuthContext.Provider value={{
      user,
      loading,
      isGuest: user?.isGuest === true,
      isAdmin: user?.role === 'ADMIN',
      login,
      register,
      loginWithGoogle,
      continueAsGuest,
      logout,
      updateUser,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
