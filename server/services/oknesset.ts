const BASE = 'https://oknesset.org/api/v2'

export interface OknessetBill {
  id: number
  title: string
  status: string
  committee?: string
  law_id?: number
  [key: string]: unknown
}

export interface OknessetCommittee {
  id: number
  name: string
  chairperson?: string
  [key: string]: unknown
}

export interface OknessetMk {
  id: number
  name: string
  party?: string
  [key: string]: unknown
}

export class OknessetClient {
  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${BASE}${path}`, {
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) throw new Error(`oknesset API error: ${res.status}`)
    return res.json() as Promise<T>
  }

  getBill(id: string): Promise<OknessetBill> {
    return this.get<OknessetBill>(`/bill/${id}/`)
  }

  getCommittee(id: string): Promise<OknessetCommittee> {
    return this.get<OknessetCommittee>(`/committee/${id}/`)
  }

  getMk(id: string): Promise<OknessetMk> {
    return this.get<OknessetMk>(`/member/${id}/`)
  }

  async getMkVotes(mkId: string, limit = 10): Promise<unknown[]> {
    const data = await this.get<{ objects: unknown[] }>(`/vote/?member=${mkId}&limit=${limit}&order_by=-time`)
    return data.objects ?? []
  }

  async getCommitteeSessions(committeeId: string, limit = 5): Promise<unknown[]> {
    const data = await this.get<{ objects: unknown[] }>(`/committeemeeting/?committee=${committeeId}&limit=${limit}&order_by=-date`)
    return data.objects ?? []
  }
}
