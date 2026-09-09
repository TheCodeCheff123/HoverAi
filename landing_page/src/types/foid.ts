/** Credential state machine states */
export type CredentialState = 'active' | 'under_review' | 'downgraded' | 'revoked'

/** Core credential claims (v1) */
export interface CredentialClaims {
  identity_verified: boolean
  bvn_validated: boolean
  age_over_18: boolean
  income_band: 'low' | 'mid' | 'high'
  account_stability: 'stable' | 'variable' | 'poor'
  repayment_reliability: 'reliable' | 'variable' | 'poor'
}

export interface FoidCredential {
  id: string
  holder: string
  state: CredentialState
  claims: CredentialClaims
  issued_at: string
  updated_at: string
}

export interface ConnectedBank {
  id: string
  name: string
  logo?: string
}

export interface Notification {
  id: string
  message: string
  change: string
  reason: string
  action: string
  timestamp: string
  read: boolean
}

export interface User {
  id: string
  firstName: string
  lastName: string
  middleName?: string
  nin: string
  email: string
  password: string
  createdAt: string
}
