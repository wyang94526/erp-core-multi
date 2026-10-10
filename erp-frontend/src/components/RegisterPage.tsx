/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 */

import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { authService } from '../api/services'
import { CompanyBrand } from './CompanyBrand'
import { useAuth } from '../context/AuthContext'

const CUSTOM_OPTION = '__custom__'

export default function RegisterPage() {
  const { register, isAuthenticated, loading } = useAuth()
  const navigate = useNavigate()

  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [questionOptions, setQuestionOptions] = useState<string[]>([])
  const [selectedQuestion, setSelectedQuestion] = useState('')
  const [customQuestion, setCustomQuestion] = useState('')
  const [securityAnswer, setSecurityAnswer] = useState('')
  const [questionsLoading, setQuestionsLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setQuestionsLoading(true)
      try {
        const result = await authService.listSecurityQuestions()
        if (cancelled) return
        const questions = result.questions || []
        setQuestionOptions(questions)
        setSelectedQuestion(questions[0] || CUSTOM_OPTION)
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : 'Unable to load security questions',
          )
          setSelectedQuestion(CUSTOM_OPTION)
        }
      } finally {
        if (!cancelled) setQuestionsLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (!loading && isAuthenticated) {
    return <Navigate to="/" replace />
  }

  const resolvedQuestion =
    selectedQuestion === CUSTOM_OPTION ? customQuestion.trim() : selectedQuestion

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }
    if (!resolvedQuestion) {
      setError('Please choose or write a security question')
      return
    }
    if (!securityAnswer.trim()) {
      setError('Please provide an answer to your security question')
      return
    }
    setSubmitting(true)
    try {
      await register(
        fullName.trim(),
        email.trim(),
        password,
        resolvedQuestion,
        securityAnswer.trim(),
      )
      navigate('/', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <CompanyBrand className="auth-brand" />
        <h1 className="auth-title">Create account</h1>
        <p className="auth-subtitle">
          New accounts start as Unassigned. An admin can grant a role after registration.
          Choose a security question for password recovery, or write your own.
        </p>

        <form className="auth-form" onSubmit={onSubmit}>
          <label className="auth-field">
            <span>Full name</span>
            <input
              type="text"
              autoComplete="name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
              disabled={submitting}
            />
          </label>
          <label className="auth-field">
            <span>Email</span>
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={submitting}
            />
          </label>
          <label className="auth-field">
            <span>Password</span>
            <input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              disabled={submitting}
            />
          </label>
          <label className="auth-field">
            <span>Security question</span>
            <select
              value={selectedQuestion}
              onChange={(e) => setSelectedQuestion(e.target.value)}
              required
              disabled={submitting || questionsLoading}
            >
              {questionsLoading && <option value="">Loading questions…</option>}
              {questionOptions.map((q) => (
                <option key={q} value={q}>
                  {q}
                </option>
              ))}
              <option value={CUSTOM_OPTION}>Write my own question…</option>
            </select>
          </label>
          {selectedQuestion === CUSTOM_OPTION && (
            <label className="auth-field">
              <span>Your security question</span>
              <input
                type="text"
                autoComplete="off"
                value={customQuestion}
                onChange={(e) => setCustomQuestion(e.target.value)}
                placeholder="e.g. What is your favorite book?"
                required
                minLength={8}
                disabled={submitting}
              />
            </label>
          )}
          <label className="auth-field">
            <span>Security answer</span>
            <input
              type="text"
              autoComplete="off"
              value={securityAnswer}
              onChange={(e) => setSecurityAnswer(e.target.value)}
              required
              disabled={submitting}
            />
          </label>

          {error && (
            <div className="auth-error" role="alert">
              {error}
            </div>
          )}

          <button
            type="submit"
            className="auth-submit"
            disabled={submitting || questionsLoading}
          >
            {submitting ? 'Creating…' : 'Create account'}
          </button>
        </form>

        <p className="auth-footer">
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  )
}
