import {useEffect, useMemo, useState} from 'react'
import {Copy, Wallet} from 'lucide-react'

import {Badge} from './components/ui/badge'
import {Button} from './components/ui/button'
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from './components/ui/card'
import {Input} from './components/ui/input'
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from './components/ui/table'

type Product = {
  id: string
  name: string
  price: number
}

type Commission = {
  id: number
  amount: number
  status: 'accrued' | 'requested' | 'paid'
  orderId: number
  productName: string
  orderValue: number
  orderCreatedAt: string
  createdAt: string
  paidAt: string | null
}

type Payout = {
  id: number
  amount: number
  status: 'requested' | 'paid'
  requestedAt: string
  completedAt: string | null
  transferReference: string | null
  transferExecutedAt: string | null
}

type DashboardResponse = {
  partner: {
    id: number
    name: string
    refCode: string
    bankAccount: string
    createdAt: string
  }
  totals: {
    availableForPayout: number
    pendingTransfer: number
    paidOut: number
    lifetime: number
  }
  commissions: Commission[]
  payouts: Payout[]
  canRequestPayout: boolean
  hasRequestedPayout: boolean
}

const COOKIE_NAME = 'partner_ref'
const moneyFormatter = new Intl.NumberFormat('pl-PL', {style: 'currency', currency: 'PLN'})

const formatMoney = (value: number) => moneyFormatter.format(value)

const getCookie = (name: string) => {
  const pair = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))

  return pair ? decodeURIComponent(pair.split('=')[1]) : null
}

const statusBadge = (status: Commission['status'] | Payout['status']) => {
  if (status === 'paid') {
    return <Badge variant="success">paid</Badge>
  }

  if (status === 'requested') {
    return <Badge variant="warning">requested</Badge>
  }

  return <Badge variant="secondary">accrued</Badge>
}

function App() {
  const [activeView, setActiveView] = useState<'store' | 'partner'>('store')

  const [products, setProducts] = useState<Product[]>([])
  const [buyerEmail, setBuyerEmail] = useState('')
  const [referralCode, setReferralCode] = useState<string | null>(null)
  const [orderMessage, setOrderMessage] = useState<string>('')

  const [partnerName, setPartnerName] = useState('')
  const [bankAccount, setBankAccount] = useState('')
  const [generatedLink, setGeneratedLink] = useState('')
  const [selectedRefCode, setSelectedRefCode] = useState('')
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null)
  const [dashboardMessage, setDashboardMessage] = useState('')
  const [isBusy, setIsBusy] = useState(false)

  const apiError = (error: unknown, fallback: string) =>
    error instanceof Error && error.message ? error.message : fallback

  useEffect(() => {
    const bootstrap = async () => {
      const productsResponse = await fetch('/api/products')
      const productsPayload = await productsResponse.json()
      setProducts(productsPayload.products)

      const params = new URLSearchParams(window.location.search)
      const refParam = params.get('ref')
      if (!refParam) {
        setReferralCode(getCookie(COOKIE_NAME))
        return
      }

      const trackResponse = await fetch('/api/track-click', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({refCode: refParam}),
      })

      if (trackResponse.ok) {
        setReferralCode(refParam)
        const newUrl = new URL(window.location.href)
        newUrl.searchParams.delete('ref')
        window.history.replaceState({}, '', newUrl)
      }
    }

    bootstrap().catch(() => {
      setOrderMessage('Nie udalo sie zaladowac danych sklepu.')
    })
  }, [])

  const summaryCards = useMemo(() => {
    if (!dashboard) {
      return []
    }

    return [
      {label: 'Do wyplaty teraz', value: formatMoney(Number(dashboard.totals.availableForPayout))},
      {label: 'W trakcie przelewu', value: formatMoney(Number(dashboard.totals.pendingTransfer))},
      {label: 'Wyplacono lacznie', value: formatMoney(Number(dashboard.totals.paidOut))},
      {label: 'Prowizje lifetime', value: formatMoney(Number(dashboard.totals.lifetime))},
    ]
  }, [dashboard])

  const buyProduct = async (productId: string) => {
    setOrderMessage('')
    if (!buyerEmail) {
      setOrderMessage('Podaj email klienta, aby zasymulowac zakup.')
      return
    }

    setIsBusy(true)
    try {
      const response = await fetch('/api/orders', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({productId, customerEmail: buyerEmail}),
      })

      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.message ?? 'Nie udalo sie zapisac zamowienia.')
      }

      if (payload.partnerRef) {
        setOrderMessage(
          `Zamowienie #${payload.orderId} zapisane. Partner ${payload.partnerRef} dostal prowizje ${formatMoney(payload.commissionAmount)}.`,
        )
      } else {
        setOrderMessage(`Zamowienie #${payload.orderId} zapisane bez polecenia partnera.`)
      }
    } catch (error) {
      setOrderMessage(apiError(error, 'Nie udalo sie zapisac zamowienia.'))
    } finally {
      setIsBusy(false)
    }
  }

  const createPartner = async () => {
    setDashboardMessage('')
    setIsBusy(true)

    try {
      const response = await fetch('/api/partners', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({name: partnerName, bankAccount}),
      })

      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.message ?? 'Nie udalo sie utworzyc partnera.')
      }

      const link = `${window.location.origin}/?ref=${payload.partner.refCode}`
      setGeneratedLink(link)
      setSelectedRefCode(payload.partner.refCode)
      setDashboardMessage(`Partner ${payload.partner.refCode} zostal utworzony i moze promowac link.`)
      await loadDashboard(payload.partner.refCode)
    } catch (error) {
      setDashboardMessage(apiError(error, 'Nie udalo sie utworzyc partnera.'))
    } finally {
      setIsBusy(false)
    }
  }

  const loadDashboard = async (refCode: string) => {
    if (!refCode) {
      setDashboardMessage('Podaj kod partnera do podgladu.')
      return
    }

    const response = await fetch(`/api/partner/${refCode}/dashboard`)
    const payload = await response.json()
    if (!response.ok) {
      throw new Error(payload.message ?? 'Nie udalo sie pobrac dashboardu.')
    }

    setDashboard(payload)
    setDashboardMessage('')
  }

  const requestPayout = async () => {
    if (!dashboard) {
      return
    }

    setIsBusy(true)
    try {
      const response = await fetch(`/api/partner/${dashboard.partner.refCode}/payout-request`, {
        method: 'POST',
      })
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.message ?? 'Nie udalo sie zlecic wyplaty.')
      }

      setDashboardMessage('Partner zazadal wyplaty. Oczekuje na mock przelew.')
      await loadDashboard(dashboard.partner.refCode)
    } catch (error) {
      setDashboardMessage(apiError(error, 'Nie udalo sie zlecic wyplaty.'))
    } finally {
      setIsBusy(false)
    }
  }

  const runMockTransfer = async (payoutId: number) => {
    if (!dashboard) {
      return
    }

    setIsBusy(true)
    try {
      const response = await fetch(`/api/payouts/${payoutId}/mock-transfer`, {
        method: 'POST',
      })
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.message ?? 'Mock przelew nie udal sie.')
      }

      setDashboardMessage(`Mock przelew wykonany: ${payload.transferReference}`)
      await loadDashboard(dashboard.partner.refCode)
    } catch (error) {
      setDashboardMessage(apiError(error, 'Mock przelew nie udal sie.'))
    } finally {
      setIsBusy(false)
    }
  }

  const copyLink = async () => {
    if (!generatedLink) {
      return
    }

    await navigator.clipboard.writeText(generatedLink)
    setDashboardMessage('Link partnerski skopiowany do schowka.')
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-4 md:p-8">
        <header className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-2xl font-bold tracking-tight">Program partnerski - sklep z telefonami</h1>
          <div className="mt-4 flex gap-2">
            <Button variant={activeView === 'store' ? 'default' : 'secondary'} onClick={() => setActiveView('store')}>
              Sklep
            </Button>
            <Button
              variant={activeView === 'partner' ? 'default' : 'secondary'}
              onClick={() => setActiveView('partner')}
            >
              Panel partnera
            </Button>
          </div>
        </header>

        {activeView === 'store' ? (
          <section className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Sesja klienta</CardTitle>
                <CardDescription>
                  Aktywny kod partnera: {referralCode ? <strong>{referralCode}</strong> : 'brak'}
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm text-slate-600">Email klienta do zamowienia</label>
                  <Input
                    type="email"
                    value={buyerEmail}
                    onChange={(event) => setBuyerEmail(event.target.value)}
                    placeholder="klient@example.com"
                  />
                </div>
              </CardContent>
            </Card>

            <div className="grid gap-4 md:grid-cols-2">
              {products.map((product) => (
                <Card key={product.id}>
                  <CardHeader>
                    <CardTitle>{product.name}</CardTitle>
                    <CardDescription>{formatMoney(product.price)}</CardDescription>
                  </CardHeader>
                  <CardContent className="flex items-center justify-between gap-3">
                    <p className="text-sm text-slate-600">Klikniecie symuluje zakup telefonu i zapis zamowienia.</p>
                    <Button disabled={isBusy} onClick={() => buyProduct(product.id)}>
                      Kup teraz
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>

            {orderMessage && <p className="rounded-md border border-slate-200 bg-white p-3 text-sm">{orderMessage}</p>}
          </section>
        ) : (
          <section className="grid gap-6 lg:grid-cols-[1fr_2fr]">
            <Card>
              <CardHeader>
                <CardTitle>Nowy partner</CardTitle>
                <CardDescription>Wygeneruj kod i link afiliacyjny.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Input value={partnerName} onChange={(event) => setPartnerName(event.target.value)}
                       placeholder="Nazwa partnera"/>
                <Input value={bankAccount} onChange={(event) => setBankAccount(event.target.value)}
                       placeholder="Numer konta bankowego"/>
                <Button disabled={isBusy} onClick={createPartner} className="w-full">
                  Wygeneruj link
                </Button>

                {generatedLink && (
                  <div className="rounded-md border border-slate-200 p-3">
                    <p className="text-xs text-slate-500">Link partnera</p>
                    <p className="mt-1 break-all text-sm">{generatedLink}</p>
                    <Button size="sm" variant="outline" className="mt-3" onClick={copyLink}>
                      <Copy className="h-4 w-4"/>
                      Kopiuj
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Dashboard partnera</CardTitle>
                  <CardDescription>Sprawdz prowizje i status wyplat.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex gap-2">
                    <Input
                      value={selectedRefCode}
                      onChange={(event) => setSelectedRefCode(event.target.value.toUpperCase())}
                      placeholder="Kod partnera, np. P-ABC123"
                    />
                    <Button
                      variant="secondary"
                      disabled={isBusy}
                      onClick={() =>
                        loadDashboard(selectedRefCode).catch((error) =>
                          setDashboardMessage(apiError(error, 'Nie udalo sie pobrac dashboardu.')),
                        )
                      }
                    >
                      Odswiez
                    </Button>
                  </div>

                  {dashboard && (
                    <div className="grid gap-2 md:grid-cols-2">
                      {summaryCards.map((item) => (
                        <div key={item.label} className="rounded-md border border-slate-200 bg-slate-50 p-3">
                          <p className="text-xs uppercase tracking-wide text-slate-500">{item.label}</p>
                          <p className="mt-1 text-lg font-semibold">{item.value}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {dashboard && (
                    <div className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 p-3 text-sm">
                      <Wallet className="h-4 w-4"/>
                      <span>Czy mozliwa wyplata: {dashboard.canRequestPayout ? 'TAK' : 'NIE'}</span>
                      <span>|</span>
                      <span>Czy partner zazadal wyplaty: {dashboard.hasRequestedPayout ? 'TAK' : 'NIE'}</span>
                      <Button
                        size="sm"
                        className="ml-auto"
                        disabled={isBusy || !dashboard.canRequestPayout}
                        onClick={requestPayout}
                      >
                        Zazadaj wyplaty
                      </Button>
                    </div>
                  )}

                  {dashboardMessage &&
                      <p className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">{dashboardMessage}</p>}
                </CardContent>
              </Card>

              {dashboard && (
                <Card>
                  <CardHeader>
                    <CardTitle>Prowizje partnera</CardTitle>
                  </CardHeader>
                  <CardContent className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>ID</TableHead>
                          <TableHead>Produkt</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Kwota</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {dashboard.commissions.map((commission) => (
                          <TableRow key={commission.id}>
                            <TableCell>#{commission.orderId}</TableCell>
                            <TableCell>{commission.productName}</TableCell>
                            <TableCell>{statusBadge(commission.status)}</TableCell>
                            <TableCell className="text-right">{formatMoney(Number(commission.amount))}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}

              {dashboard && (
                <Card>
                  <CardHeader>
                    <CardTitle>Mock transakcje bankowe</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {dashboard.payouts.length === 0 && <p className="text-sm text-slate-600">Brak zleconych wyplat.</p>}

                    {dashboard.payouts.map((payout) => (
                      <div key={payout.id} className="rounded-md border border-slate-200 p-3 text-sm">
                        <div className="flex items-center gap-2">
                          <strong>Wyplata #{payout.id}</strong>
                          {statusBadge(payout.status)}
                          <span className="ml-auto font-semibold">{formatMoney(Number(payout.amount))}</span>
                        </div>
                        <p className="mt-2 text-slate-600">Ref
                          przelewu: {payout.transferReference ?? 'jeszcze brak'}</p>
                        {payout.status === 'requested' && (
                          <Button size="sm" variant="outline" className="mt-3"
                                  onClick={() => runMockTransfer(payout.id)}>
                            Wykonaj mock przelew
                          </Button>
                        )}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
            </div>
          </section>
        )}
      </div>
    </main>
  )
}

export default App
