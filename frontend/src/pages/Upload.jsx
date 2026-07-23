import { useState, useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import { motion, AnimatePresence } from 'framer-motion'
import { Upload as UploadIcon, FileText, CheckCircle, XCircle, Loader2, Brain, Eye, Cpu, Sparkles, X } from 'lucide-react'
import { toast } from 'sonner'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import api from '../lib/api'
import ThemeToggle from '../components/ThemeToggle'

const steps = [
  { icon: UploadIcon, label: 'Uploading File', desc: 'Sending PDF to server...' },
  { icon: Eye, label: 'Extracting Text', desc: 'Reading document content...' },
  { icon: Cpu, label: 'OCR Processing', desc: 'Analyzing scanned content...' },
  { icon: Brain, label: 'Generating Embeddings', desc: 'Creating vector representations...' },
  { icon: Sparkles, label: 'Preparing AI Assistant', desc: 'Almost done...' },
]

export default function Upload() {
  const [files, setFiles] = useState([])
  const [processing, setProcessing] = useState({})
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const uploadMutation = useMutation({
    mutationFn: async ({ file, title }) => {
      const form = new FormData()
      form.append('file', file)
      form.append('title', title || file.name.replace(/\.pdf$/i, ''))
      return fetch('/api/documents/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('docmind_token')}` },
        body: form,
      }).then(r => r.json())
    },
  })

  const onDrop = useCallback((accepted, rejected) => {
    if (rejected.length > 0) {
      toast.error('Only PDF files up to 50MB are allowed')
      return
    }
    setFiles(prev => [...prev, ...accepted.map(f => ({ file: f, title: f.name.replace(/\.pdf$/i, ''), id: Math.random().toString(36).slice(2) }))])
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/pdf': ['.pdf'] },
    maxSize: 50 * 1024 * 1024,
    multiple: true,
  })

  const handleUpload = async (item) => {
    setProcessing(p => ({ ...p, [item.id]: 0 }))

    // Simulate processing steps
    for (let i = 0; i <= 4; i++) {
      await new Promise(r => setTimeout(r, 800))
      setProcessing(p => ({ ...p, [item.id]: i }))
    }

    const result = await uploadMutation.mutateAsync({ file: item.file, title: item.title })
    if (result.document) {
      setProcessing(p => ({ ...p, [item.id]: 'done' }))
      queryClient.invalidateQueries(['analytics'])
      toast.success(`"${item.title}" uploaded successfully!`)
    } else {
      setProcessing(p => ({ ...p, [item.id]: 'error' }))
      toast.error(result.error || 'Upload failed')
    }
  }

  const removeFile = (id) => setFiles(f => f.filter(x => x.id !== id))

  const handleUploadAll = () => {
    files.filter(f => !processing[f.id]).forEach(f => handleUpload(f))
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', background: 'var(--bg-primary)' }}>
      <div className="header-container" style={{ borderBottom: '1px solid var(--border)', padding: '16px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--bg-sidebar)', position: 'sticky', top: 0, zIndex: 10 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>Upload Documents</h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Supports PDF, scanned PDFs, images. Max file size: 50MB</p>
        </div>
        <ThemeToggle />
      </div>

      <div className="dashboard-container" style={{ padding: 32, maxWidth: 860, margin: '0 auto' }}>
        {/* Drop Zone */}
        <div {...getRootProps()}
          className={`upload-zone ${isDragActive ? 'drag-over' : ''}`}
          style={{ padding: '60px 32px', textAlign: 'center', marginBottom: 32 }}
        >
          <input {...getInputProps()} />
          <motion.div animate={isDragActive ? { scale: 1.1 } : { scale: 1 }}>
            <div style={{ width: 80, height: 80, borderRadius: 24, background: 'rgba(108,99,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
              <UploadIcon size={36} color="#6C63FF" />
            </div>
          </motion.div>
          <h3 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>
            {isDragActive ? 'Drop your files here!' : 'Drag & Drop PDF here'}
          </h3>
          <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 20 }}>or click to browse your files</p>
          <button className="btn btn-secondary btn-sm">Browse Files</button>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 16 }}>
            Supports: PDF, JPG, PNG, TIFF · Max size: 50MB per file
          </p>
        </div>

        {/* File List */}
        <AnimatePresence>
          {files.length > 0 && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>{files.length} file{files.length > 1 ? 's' : ''} ready</h3>
                <button className="btn btn-primary btn-sm" onClick={handleUploadAll}>
                  <UploadIcon size={14} /> Upload All
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {files.map(item => {
                  const status = processing[item.id]
                  const isDone = status === 'done'
                  const isError = status === 'error'
                  const isProcessing = typeof status === 'number'
                  const currentStep = isProcessing ? status : null

                  return (
                    <motion.div key={item.id} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}
                      className="card" style={{ padding: 20 }}
                    >
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
                        <div style={{ width: 48, height: 48, borderRadius: 12, background: isDone ? 'rgba(16,185,129,0.1)' : isError ? 'rgba(239,68,68,0.1)' : 'rgba(108,99,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          {isDone ? <CheckCircle size={24} color="#10b981" /> : isError ? <XCircle size={24} color="#ef4444" /> : isProcessing ? <Loader2 size={24} color="#6C63FF" style={{ animation: 'spin 1s linear infinite' }} /> : <FileText size={24} color="#6C63FF" />}
                        </div>
                        <div style={{ flex: 1 }}>
                          <input className="input" value={item.title}
                            onChange={e => setFiles(f => f.map(x => x.id === item.id ? { ...x, title: e.target.value } : x))}
                            style={{ marginBottom: 8, fontWeight: 600 }}
                            disabled={isProcessing || isDone}
                          />
                          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: isProcessing ? 12 : 0 }}>
                            {(item.file.size / 1024 / 1024).toFixed(2)} MB
                          </p>

                          {/* Processing Steps */}
                          {isProcessing && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                              {steps.map((step, i) => {
                                const StepIcon = step.icon
                                const done = i < currentStep
                                const active = i === currentStep
                                return (
                                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, opacity: done || active ? 1 : 0.3 }}>
                                    <div style={{ width: 20, height: 20, borderRadius: 6, background: done ? 'rgba(16,185,129,0.15)' : active ? 'rgba(108,99,255,0.15)' : 'var(--bg-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                      {done ? <CheckCircle size={11} color="#10b981" /> : active ? <Loader2 size={11} color="#6C63FF" style={{ animation: 'spin 1s linear infinite' }} /> : <StepIcon size={11} color="var(--text-muted)" />}
                                    </div>
                                    <span style={{ fontSize: 12, color: done ? '#10b981' : active ? '#6C63FF' : 'var(--text-muted)', fontWeight: active ? 600 : 400 }}>
                                      {step.label}
                                    </span>
                                  </div>
                                )
                              })}
                            </div>
                          )}
                        </div>

                        <div style={{ display: 'flex', gap: 8 }}>
                          {!isProcessing && !isDone && (
                            <button className="btn btn-primary btn-sm" onClick={() => handleUpload(item)}>Upload</button>
                          )}
                          {isDone && (
                            <button className="btn btn-secondary btn-sm" onClick={() => navigate('/chat')}>
                              Chat Now
                            </button>
                          )}
                          {!isDone && !isProcessing && (
                            <button className="btn-icon" onClick={() => removeFile(item.id)}><X size={15} /></button>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  )
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Tips */}
        <div className="card" style={{ padding: 24, marginTop: 32 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 16 }}>💡 Tips for best results</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {[
              ['📄', 'Text PDFs are processed instantly'],
              ['🔍', 'Scanned PDFs use OCR automatically'],
              ['📦', 'Batch upload multiple files at once'],
              ['💬', 'Chat with documents right after upload'],
            ].map(([icon, text]) => (
              <div key={text} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: 'var(--bg-tertiary)', borderRadius: 10 }}>
                <span style={{ fontSize: 16 }}>{icon}</span>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
