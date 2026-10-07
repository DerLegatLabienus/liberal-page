import { describe, it, expect } from 'vitest'
import {
  MAX_ERROR_CHARS,
  MAX_ROWS,
  apiUrlFor,
  buildRequest,
  capRows,
  checkStatement,
  describeFetchError,
  formatFailure,
  scrubSecret,
} from '../../../scripts/loop/sql'

const POOLED = 'postgresql://loop_reader:s3cr3t-Pa55@ep-twilight-salad-al8jrv7f-pooler.c-3.eu-central-1.aws.neon.tech/neondb?sslmode=require'
const DIRECT = 'postgresql://loop_reader:s3cr3t-Pa55@ep-twilight-salad-al8jrv7f.c-3.eu-central-1.aws.neon.tech/neondb?sslmode=require'

describe('apiUrlFor', () => {
  it('swaps the first host label for "api" on a pooled host', () => {
    expect(apiUrlFor(POOLED)).toBe('https://api.c-3.eu-central-1.aws.neon.tech/sql')
  })

  it('does the same for a non-pooled host', () => {
    expect(apiUrlFor(DIRECT)).toBe('https://api.c-3.eu-central-1.aws.neon.tech/sql')
  })

  it('works for a connection string with no password', () => {
    expect(apiUrlFor('postgresql://loop_reader@ep-x.eu-central-1.aws.neon.tech/neondb')).toBe(
      'https://api.eu-central-1.aws.neon.tech/sql',
    )
  })

  it('never carries the credentials, path or query into the URL', () => {
    const url = apiUrlFor(POOLED)
    expect(url).not.toContain('s3cr3t')
    expect(url).not.toContain('loop_reader')
    expect(url).not.toContain('neondb')
  })

  it('throws on something that is not a connection string, without echoing it', () => {
    expect(() => apiUrlFor('not a url s3cr3t-Pa55')).toThrow(/LOOP_DATABASE_URL is not a valid connection string/)
    try {
      apiUrlFor('not a url s3cr3t-Pa55')
    } catch (e) {
      expect(String((e as Error).message)).not.toContain('s3cr3t')
    }
  })
})

describe('buildRequest', () => {
  it('posts the query as JSON with the connection string in its header', () => {
    const req = buildRequest(POOLED, 'select 1')
    expect(req.url).toBe('https://api.c-3.eu-central-1.aws.neon.tech/sql')
    expect(req.init.method).toBe('POST')
    expect(req.init.headers).toEqual({
      'Content-Type': 'application/json',
      'Neon-Connection-String': POOLED,
    })
    expect(JSON.parse(req.init.body)).toEqual({ query: 'select 1', params: [] })
  })

  it('keeps the secret out of the body', () => {
    expect(buildRequest(POOLED, 'select 1').init.body).not.toContain('s3cr3t')
  })
})

describe('checkStatement', () => {
  const ok = (sql: string) => expect(checkStatement(sql).ok, sql).toBe(true)
  const refused = (sql: string, reason: RegExp) => {
    const r = checkStatement(sql)
    expect(r.ok, sql).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(reason)
  }

  it('accepts read statements', () => {
    ok('select count(*) from loop_read.bills')
    ok('  SELECT 1')
    ok('with t as (select 1 as a) select a from t')
    ok('WITH t AS (SELECT 1) SELECT * FROM t')
    ok('explain select 1')
    ok('show statement_timeout')
    ok('values (1), (2)')
  })

  it('accepts a statement after leading comments', () => {
    ok('-- how many bills\nselect count(*) from loop_read.bills')
    ok('/* shape check */ select 1')
    ok('/* a */ -- b\n /* c */\n  select 1')
  })

  it('accepts one trailing semicolon, with or without trailing comment', () => {
    ok('select 1;')
    ok('select 1;  \n')
    ok('select 1; -- done')
    ok('select 1; /* done */')
  })

  it('returns the statement without its trailing semicolon', () => {
    const r = checkStatement('  select 1 ;  ')
    expect(r).toEqual({ ok: true, statement: 'select 1' })
  })

  it('refuses anything that is not a read', () => {
    refused('create table loop_read.t (a int)', /only read statements/i)
    refused('insert into loop_read.letter_issue_tags values (1)', /only read statements/i)
    refused('update x set a = 1', /only read statements/i)
    refused('delete from x', /only read statements/i)
    refused('drop schema loop_read cascade', /only read statements/i)
    refused('set transaction read write', /only read statements/i)
    refused('begin', /only read statements/i)
    refused('-- sneaky\ndrop table x', /only read statements/i)
    refused('selectx 1', /only read statements/i)
  })

  it('refuses an empty statement or one that is only comments', () => {
    refused('', /empty/i)
    refused('   ', /empty/i)
    refused('-- nothing here', /empty/i)
    refused('/* nothing */', /empty/i)
  })

  it('refuses more than one statement', () => {
    refused('select 1; drop table x', /one statement/i)
    refused('select 1; select 2', /one statement/i)
    refused('select 1;;select 2', /one statement/i)
  })

  it('does not mistake a semicolon inside a string, identifier, dollar quote or comment for a second statement', () => {
    ok("select 'a; b' as x")
    ok("select 'it''s; fine' as x")
    ok('select 1 as "odd;name"')
    ok('select $$a; b$$ as x')
    ok('select $tag$a; b$tag$ as x')
    ok('select 1 -- trailing; comment')
    ok('select 1 /* inner; comment */ + 1')
  })

  it('still sees a second statement after a string that contains a semicolon', () => {
    refused("select 'a; b'; drop table x", /one statement/i)
  })
})

describe('capRows', () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ i }))

  it('passes a small result through untouched', () => {
    expect(capRows(rows(3))).toEqual({ rows: rows(3), omitted: 0 })
    expect(capRows([])).toEqual({ rows: [], omitted: 0 })
  })

  it('passes exactly the limit through', () => {
    expect(MAX_ROWS).toBe(200)
    const r = capRows(rows(200))
    expect(r.rows).toHaveLength(200)
    expect(r.omitted).toBe(0)
  })

  it('keeps the first 200 rows and counts the rest', () => {
    const r = capRows(rows(205))
    expect(r.rows).toHaveLength(200)
    expect(r.rows[199]).toEqual({ i: 199 })
    expect(r.omitted).toBe(5)
  })
})

describe('scrubSecret', () => {
  it('removes the whole connection string', () => {
    expect(scrubSecret(`failed to reach ${POOLED} today`, POOLED)).toBe('failed to reach *** today')
  })

  it('removes the password when it appears on its own', () => {
    const out = scrubSecret('auth failed for s3cr3t-Pa55 (role loop_reader)', POOLED)
    expect(out).not.toContain('s3cr3t-Pa55')
    expect(out).toContain('***')
    expect(out).toContain('loop_reader')
  })

  it('removes a percent-encoded password in both its encoded and decoded forms', () => {
    const conn = 'postgresql://loop_reader:p%40ss%2Fword@ep-x.eu-central-1.aws.neon.tech/neondb'
    expect(scrubSecret('bad p%40ss%2Fword here', conn)).not.toContain('p%40ss%2Fword')
    expect(scrubSecret('bad p@ss/word here', conn)).not.toContain('p@ss/word')
  })

  it('leaves text alone when there is nothing to hide', () => {
    expect(scrubSecret('permission denied for schema auth', POOLED)).toBe('permission denied for schema auth')
    expect(scrubSecret('some error', 'postgresql://loop_reader@ep-x.aws.neon.tech/neondb')).toBe('some error')
    expect(scrubSecret('some error', 'garbage')).toBe('some error')
  })

  it('removes every occurrence', () => {
    expect(scrubSecret('s3cr3t-Pa55 and s3cr3t-Pa55', POOLED)).toBe('*** and ***')
  })
})

// Added after the independent pre-push review (2026-10-07).
describe('apiUrlFor: where the secret may be sent', () => {
  const refused = (value: string) => {
    let message = ''
    try { apiUrlFor(value) } catch (e) { message = (e as Error).message }
    return message
  }

  it('refuses a host outside neon.tech, so a wrong value cannot send the secret elsewhere', () => {
    expect(refused('postgresql://u:pw@evil.example.com/db')).toMatch(/Neon endpoint host/)
    expect(refused('postgresql://u:pw@neon.tech@evil.example.com/db')).toMatch(/Neon endpoint host/)
    expect(refused('postgresql://u:pw@ep-a.neon.tech.evil.example/db')).toMatch(/Neon endpoint host/)
    expect(refused('postgresql://u:pw@localhost/db')).toMatch(/Neon endpoint host/)
    expect(refused('postgresql://u:pw@10.0.0.5/db')).toMatch(/Neon endpoint host/)
  })

  it('refuses a host too short to have an endpoint label and a region', () => {
    expect(refused('postgresql://u:pw@neon.tech/db')).toMatch(/Neon endpoint host/)
    expect(refused('postgresql://u:pw@ep-a.neon.tech/db')).toMatch(/Neon endpoint host/)
  })

  it('refuses a scheme that is not postgres', () => {
    expect(refused('https://u:pw@ep-a.c-3.eu-central-1.aws.neon.tech/db')).toMatch(/postgres:\/\//)
  })

  it('never puts the value or its password in the error', () => {
    for (const v of ['postgresql://u:TOPSECRET@evil.example.com/db', 'https://u:TOPSECRET@ep-a.c-3.aws.neon.tech/db', 'TOPSECRET not a url']) {
      expect(refused(v)).not.toContain('TOPSECRET')
    }
  })

  it('accepts an upper-case host and a host with a port', () => {
    expect(apiUrlFor('postgres://u:pw@EP-A-pooler.C-3.eu-central-1.aws.neon.tech:5432/db')).toBe('https://api.c-3.eu-central-1.aws.neon.tech/sql')
  })
})

describe('buildRequest: redirects', () => {
  it('tells fetch to fail on a redirect, which would forward the secret header', () => {
    expect(buildRequest(POOLED, 'select 1').init.redirect).toBe('error')
  })
})

describe('checkStatement: forms the review found wrongly refused or mis-scanned', () => {
  it('accepts a parenthesised select, the table command and stray trailing semicolons', () => {
    expect(checkStatement('(select 1) union all (select 2)').ok).toBe(true)
    expect(checkStatement('table loop_read.bills').ok).toBe(true)
    expect(checkStatement('select 1;;').ok).toBe(true)
    expect(checkStatement('select 1; ; -- done').ok).toBe(true)
  })

  it('still refuses a second statement after stray semicolons', () => {
    expect(checkStatement('select 1;; drop table t').ok).toBe(false)
  })

  it('does not treat $b$ inside an identifier as a dollar quote', () => {
    expect(checkStatement('select a$b$c from t; drop table t').ok).toBe(false)
    expect(checkStatement('select $b$ ; $b$ as x').ok).toBe(true)
  })

  it('still refuses a write behind a parenthesis', () => {
    expect(checkStatement('(delete from t)').ok).toBe(false)
  })
})

describe('formatFailure', () => {
  it('shows a database error message as it is', () => {
    expect(formatFailure(400, JSON.stringify({ message: 'permission denied for schema auth' }), POOLED)).toBe('permission denied for schema auth')
  })

  it('scrubs before shortening, so a secret straddling the cut cannot leak a fragment', () => {
    // The connection string begins just before the cut point of the raw body.
    const body = 'x'.repeat(MAX_ERROR_CHARS - 30) + ' header was ' + POOLED + ' end'
    const out = formatFailure(502, body, POOLED)
    expect(out).not.toContain('s3cr3t')
    expect(out).not.toContain('loop_reader:')
    expect(out.startsWith('HTTP 502: ')).toBe(true)
  })

  it('scrubs and shortens a long JSON message too', () => {
    const out = formatFailure(400, JSON.stringify({ message: 'bad ' + POOLED + ' ' + 'y'.repeat(5000) }), POOLED)
    expect(out).not.toContain('s3cr3t')
    expect(out.length).toBeLessThanOrEqual(MAX_ERROR_CHARS + 1)
  })
})

describe('scrubSecret: spellings of the password', () => {
  it('removes the secret when the variable had surrounding whitespace', () => {
    expect(scrubSecret(`invalid header value "${POOLED}"`, `  ${POOLED}\n`)).not.toContain('s3cr3t')
  })

  it('removes a password written with a raw @ and a percent escape, in every spelling', () => {
    const conn = 'postgresql://u:p@ss%2Fw@ep-a.c-3.eu-central-1.aws.neon.tech/db'
    for (const form of ['p@ss%2Fw', 'p@ss%2fw', 'p@ss/w', 'p%40ss%2Fw', 'p%40ss%2fw']) {
      expect(scrubSecret(`saw ${form} here`, conn), form).toBe('saw *** here')
    }
  })

  it('removes a password passed as a query parameter', () => {
    const conn = 'postgresql://u@ep-a.c-3.eu-central-1.aws.neon.tech/db?password=Hidden%21one'
    expect(scrubSecret('got Hidden!one and Hidden%21one', conn)).toBe('got *** and ***')
  })
})

describe('describeFetchError', () => {
  it('uses fixed words, never the error message, which can quote a header value', () => {
    const err = new TypeError(`Invalid header value "${POOLED}"`)
    expect(describeFetchError(err)).toBe('the request could not be sent')
  })

  it('reports a network error code and a timeout', () => {
    expect(describeFetchError(Object.assign(new Error('fetch failed'), { cause: { code: 'ENOTFOUND' } }))).toBe('ENOTFOUND')
    expect(describeFetchError(Object.assign(new Error('x'), { name: 'TimeoutError' }))).toMatch(/no answer within/)
  })

  it('ignores a cause code that is not a plain error code', () => {
    const err = Object.assign(new Error('x'), { cause: { code: `weird ${POOLED}` } })
    expect(describeFetchError(err)).toBe('the request could not be sent')
  })
})
