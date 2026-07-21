import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { useToast } from '@/contexts/ToastContext'
import { api, type EmailTemplate } from '@/lib/api-client'
import HtmlCodeEditor from '@/components/admin/HtmlCodeEditor'

/** One accordion item per email template: subject + a Source / Preview editor, saved to the DB. */
export default function EmailTemplatesSection() {
  const { toast } = useToast()
  const [templates, setTemplates] = useState<EmailTemplate[]>([])

  const load = useCallback(async () => {
    try { setTemplates((await api.admin.emailTemplates.list()).templates) }
    catch (e) { toast(e instanceof Error ? e.message : 'Failed to load templates', 'error') }
  }, [toast])

  useEffect(() => { void load() }, [load])

  const edit = (name: string, patch: Partial<EmailTemplate>) =>
    setTemplates((prev) => prev.map((tpl) => (tpl.name === name ? { ...tpl, ...patch } : tpl)))

  const save = async (tpl: EmailTemplate) => {
    try { await api.admin.emailTemplates.update(tpl.name, { subject: tpl.subject, html: tpl.html }); toast('Template saved', 'success') }
    catch (e) { toast(e instanceof Error ? e.message : 'Failed to save template', 'error') }
  }

  if (templates.length === 0) return <p className="text-sm text-muted-foreground">No templates yet.</p>

  return (
    <Accordion>
      {templates.map((tpl) => (
        <AccordionItem key={tpl.name} value={tpl.name}>
          <AccordionTrigger className="font-mono text-xs">{tpl.name}</AccordionTrigger>
          <AccordionContent>
            <div className="space-y-3 pb-1">
              <Input
                value={tpl.subject}
                onChange={(e) => edit(tpl.name, { subject: e.target.value })}
                placeholder="Subject"
              />
              <Tabs defaultValue="source">
                <TabsList>
                  <TabsTrigger value="source">Source</TabsTrigger>
                  <TabsTrigger value="preview">Preview</TabsTrigger>
                </TabsList>
                <TabsContent value="source">
                  <div className="mt-2">
                    <HtmlCodeEditor
                      value={tpl.html}
                      onChange={(html) => edit(tpl.name, { html })}
                      ariaLabel={`${tpl.name} HTML`}
                    />
                  </div>
                </TabsContent>
                <TabsContent value="preview">
                  <iframe
                    srcDoc={tpl.html}
                    className="mt-2 h-52 w-full rounded-lg border border-border bg-card"
                    sandbox="allow-same-origin"
                    title={`${tpl.name} preview`}
                  />
                </TabsContent>
              </Tabs>
              <Button size="sm" onClick={() => void save(tpl)}>Save</Button>
            </div>
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  )
}
