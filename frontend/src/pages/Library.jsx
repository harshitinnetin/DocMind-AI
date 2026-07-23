import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { FileText, Search, Filter, Trash2, MessageSquare, Plus, CheckCircle, Clock, AlertTriangle, ExternalLink } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { formatDistanceToNow } from 'date-fns'
import { toast } from 'sonner'
import api from '../lib/api'

export default function Library() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')

  const { data, isLoading } = useQuery({
    queryKey: ['documents', search, filterStatus],
    queryFn: () => api.get(`/documents?search=${search}&status=${filterStatus === 'all' ? '' : filterStatus}`),
  })

  const deleteMutation = useMutation({
    mutationFn: (id) => api.delete(`/documents/${id}`),
    onSuccess: () => {
      toast.success('Document deleted')
      queryClient.invalidateQueries(['documents'])
      queryClient.invalidateQueries(['analytics'])
    },
  })

  const documents = data?.documents || []

  return (
    <div style={{ flex: 1, overflowY: 'auto', background: 'var(--bg-primary)' }}>
      <div className="header-container" style={{ borderBottom: '1px solid var(--border)', padding: '16px 32px', background: 'var(--bg-sidebar)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>Document Library</h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Manage and inspect all your uploaded PDF files</p>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => navigate('/upload')}>
          <Plus size={14} /> Upload New PDF
        </button>
      </div>

      <div className="dashboard-container" style={{ padding: 32 }}>
        {/* Filters */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 240, position: 'relative' }}>
            <Search size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input className="input" placeholder="Search document title..." value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: 36 }} />
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {['all', 'READY', 'PROCESSING', 'FAILED'].map(status => (
              <button key={status} onClick={() => setFilterStatus(status)}
                className={`btn ${filterStatus === status ? 'btn-primary' : 'btn-secondary'} btn-sm`}
                style={{ textTransform: 'capitalize' }}
              >
                {status.toLowerCase()}
              </button>
            ))}
          </div>
        </div>

        {/* Grid */}
        {isLoading ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
            {[...Array(6)].map((_, i) => (
              <div key={i} className="card" style={{ padding: 20 }}>
                <div className="skeleton" style={{ width: 44, height: 44, borderRadius: 12, marginBottom: 12 }} />
                <div className="skeleton" style={{ width: '70%', height: 20, marginBottom: 8 }} />
                <div className="skeleton" style={{ width: '40%', height: 14 }} />
              </div>
            ))}
          </div>
        ) : documents.length === 0 ? (
          <div className="card" style={{ padding: 60, textAlign: 'center' }}>
            <FileText size={48} style={{ color: 'var(--text-muted)', margin: '0 auto 16px', display: 'block', opacity: 0.3 }} />
            <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>No documents found</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 20 }}>Try adjusting your search query or upload a new PDF.</p>
            <button className="btn btn-primary" onClick={() => navigate('/upload')}>
              <Plus size={16} /> Upload PDF
            </button>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
            {documents.map(doc => (
              <motion.div key={doc.id} layout initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
                className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
                    <div style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(108,99,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <FileText size={22} color="#6C63FF" />
                    </div>
                    <span className={`badge badge-${doc.status === 'READY' ? 'success' : doc.status === 'PROCESSING' ? 'warning' : 'error'}`}>
                      {doc.status.toLowerCase()}
                    </span>
                  </div>

                  <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {doc.title}
                  </h3>
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
                    {doc.pageCount ? `${doc.pageCount} pages · ` : ''}{(doc.fileSize / (1024 * 1024)).toFixed(1)} MB · {formatDistanceToNow(new Date(doc.createdAt), { addSuffix: true })}
                  </p>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                  <button className="btn btn-primary btn-sm" style={{ flex: 1 }} onClick={() => navigate(`/chat?doc=${doc.id}`)} disabled={doc.status !== 'READY'}>
                    <MessageSquare size={13} /> Chat
                  </button>
                  <button className="btn-icon" onClick={() => window.open(`/api/documents/${doc.id}/file`, '_blank')} title="View PDF">
                    <ExternalLink size={15} />
                  </button>
                  <button className="btn-icon" onClick={() => deleteMutation.mutate(doc.id)} title="Delete document">
                    <Trash2 size={15} color="#ef4444" />
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
