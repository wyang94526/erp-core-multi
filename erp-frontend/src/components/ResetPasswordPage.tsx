/**
 * @author: Wendy Yang
 * @date: 2026-09-19
 */

import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { authService } from '../api/services'

const MIN_PASSWORD_LENGTH = 8

type Step = 'email' | 'reset'

export default function ResetPasswordPage() {
  const navigate = useNavigate()

  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [securityQuestion, setSecurityQuestion] = useState('')
  const [securityAnswer, setSecurityAnswer] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  useEffect(() => {
    if (!success) return
    const timer = window.setTimeout(() => navigate('/login', { replace: true }), 1500)
    return () => window.clearTimeout(timer)
  }, [success, navigate])

  const onLookup = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    setSubmitting(true)
    try {
      const result = await authService.lookupSecurityQuestion({ email: email.trim() })
      setSecurityQuestion(result.security_question)
      setStep('reset')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to find recovery question')
    } finally {
      setSubmitting(false)
    }
  }

  const onReset = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccess(null)

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setError(`New password must be at least ${MIN_PASSWORD_LENGTH} characters`)
      return
    }
    if (newPassword !== confirmPassword) {
      setError('New password and confirmation do not match')
      return
    }
    if (!securityAnswer.trim()) {
      setError('Please answer your security question')
      return
    }

    setSubmitting(true)
    try {
      const result = await authService.resetPassword({
        email: email.trim(),
        security_answer: securityAnswer.trim(),
        new_password: newPassword,
      })
      setSuccess(result.message || 'Password reset successfully')
      setSecurityAnswer('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset password')
    } finally {
      setSubmitting(false)
    }
  }

  const goBackToEmail = () => {
    setStep('email')
    setSecurityQuestion('')
    setSecurityAnswer('')
    setNewPassword('')
    setConfirmPassword('')
    setError(null)
    setSuccess(null)
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">Grand-Tek Technology USA</div>
        <h1 className="auth-title">Reset password</h1>
        <p className="auth-subtitle">
          {step === 'email'
            ? 'Enter your work email to load your security question.'
            : 'Answer your security question, then choose a new password.'}
        </p>

        {step === 'email' ? (
          <form className="auth-form" onSubmit={onLookup}>
            <label className="auth-field">
              <span>Work email</span>
              <input
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={submitting}
              />
            </label>

            {error && (
              <div className="auth-error" role="alert">
                {error}
              </div>
            )}

            <button type="submit" className="auth-submit" disabled={submitting}>
              {submitting ? 'Checking…' : 'Continue'}
            </button>
          </form>
        ) : (
          <form className="auth-form" onSubmit={onReset}>
            <label className="auth-field">
              <span>Work email</span>
              <input type="email" value={email} disabled readOnly />
            </label>
            <label className="auth-field">
              <span>Security question</span>
              <input type="text" value={securityQuestion} disabled readOnly />
            </label>
            <label className="auth-field">
              <span>Your answer</span>
              <input
                type="text"
                autoComplete="off"
                value={securityAnswer}
                onChange={(e) => setSecurityAnswer(e.target.value)}
                required
                disabled={submitting || Boolean(success)}
              />
            </label>
            <label className="auth-field">
              <span>New password</span>
              <input
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={MIN_PASSWORD_LENGTH}
                disabled={submitting || Boolean(success)}
              />
            </label>
            <label className="auth-field">
              <span>Confirm new password</span>
              <input
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={MIN_PASSWORD_LENGTH}
                disabled={submitting || Boolean(success)}
              />
            </label>

            {error && (
              <div className="auth-error" role="alert">
                {error}
              </div>
            )}
            {success && (
              <div className="auth-success" role="status">
                {success} Redirecting to sign in…
              </div>
            )}

            <button
              type="submit"
              className="auth-submit"
              disabled={submitting || Boolean(success)}
            >
              {submitting ? 'Resetting…' : 'Reset password'}
            </button>
            <button
              type="button"
              className="auth-secondary"
              onClick={goBackToEmail}
              disabled={submitting || Boolean(success)}
            >
              Use a different email
            </button>
          </form>
        )}

        <p className="auth-footer">
          Remembered it? <Link to="/login">Sign in</Link>
          {' · '}
          <Link to="/change-password">Change with current password</Link>
        </p>
        <p className="auth-hint">
          Demo accounts use security question “What is your favorite color?” with answer{' '}
          <code>blue</code>
        </p>
      </div>
    </div>
  )
}
