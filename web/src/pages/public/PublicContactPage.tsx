import { Mail, MapPin, Music2, Phone, Users, Youtube } from "lucide-react"
import { Card, Spinner } from "../../components/ui"
import { PublicPageHeader } from "../../components/layout/PublicPageHeader"
import { APPLICATION_FORM_URL, YOUTUBE_CHANNEL_URL } from "../../components/layout/PublicLayout"
import { useQuery } from "../../api/hooks"

interface ContactData {
  about: string
  contact: { email: string; phone: string }
  applicationFormUrl: string
}

/**
 * Everything a visitor needs to reach the choir: the public contact details the
 * Chairman sets in Settings, the official application form, and the places the
 * choir is published.
 */
export function PublicContactPage() {
  const { data, loading } = useQuery<ContactData>("/public/landing")
  const formUrl = data?.applicationFormUrl || APPLICATION_FORM_URL

  return (
    <div className="min-h-dvh bg-ivory dark:bg-charcoal-950">
      <PublicPageHeader
        title="Contact us"
        description="Whether you want to sing with us, invite the choir, or simply ask a question, this is how to reach Chorale La Porte d'Or."
      />

      <section className="mx-auto max-w-7xl px-5 py-14">
        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="p-6">
            <h2 className="font-display text-2xl font-semibold">Reach the choir</h2>
            {loading ? (
              <div className="mt-4 flex items-center gap-2">
                <Spinner /> <span className="muted text-sm">Loading the contact details…</span>
              </div>
            ) : data?.contact.email || data?.contact.phone ? (
              <ul className="mt-4 flex flex-col gap-3 text-sm">
                {data.contact.email ? (
                  <li className="flex items-center gap-2">
                    <Mail size={16} className="text-gold-600 dark:text-gold-300" />
                    <a href={`mailto:${data.contact.email}`} className="link">
                      {data.contact.email}
                    </a>
                  </li>
                ) : null}
                {data.contact.phone ? (
                  <li className="flex items-center gap-2">
                    <Phone size={16} className="text-gold-600 dark:text-gold-300" />
                    <a href={`tel:${data.contact.phone.replace(/\s+/g, "")}`} className="link">
                      {data.contact.phone}
                    </a>
                  </li>
                ) : null}
                <li className="flex items-center gap-2">
                  <Youtube size={16} className="text-gold-600 dark:text-gold-300" />
                  <a href={YOUTUBE_CHANNEL_URL} target="_blank" rel="noopener noreferrer" className="link">
                    Our YouTube channel
                  </a>
                </li>
              </ul>
            ) : (
              <p className="muted mt-4 text-sm">
                Public contact details have not been published yet. They are set by the Chairman in the platform's
                Settings, and will appear here as soon as they are added.
              </p>
            )}
          </Card>

          <Card className="p-6">
            <h2 className="font-display text-2xl font-semibold">Join the choir</h2>
            <p className="muted mt-3 text-sm">
              Membership is received through the official application form. Your application goes straight to the
              administrator of the group you are applying to, who reviews it and sets up your account if you are
              accepted. There is no public self-registration.
            </p>
            <a href={formUrl} target="_blank" rel="noopener noreferrer" className="btn btn-gold mt-5">
              Open the official application form
            </a>
            <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm">
              <span className="flex items-center gap-2">
                <Users size={16} className="text-gold-600 dark:text-gold-300" />
                <span className="muted">Senior · Junior · Support</span>
              </span>
              <span className="flex items-center gap-2">
                <Music2 size={16} className="text-gold-600 dark:text-gold-300" />
                <span className="muted">Our performances are online</span>
              </span>
            </div>
          </Card>
        </div>

        <Card className="mt-6 p-6">
          <div className="flex items-start gap-3">
            <MapPin size={18} className="mt-0.5 shrink-0 text-gold-600 dark:text-gold-300" />
            <div>
              <h2 className="font-display text-xl font-semibold">Where we are</h2>
              <p className="muted mt-1 text-sm">
                Chorale La Porte d'Or rehearses and performs locally, and publishes its recordings on its official
                YouTube channel. Rehearsal times and venue are shared with members inside the platform.
              </p>
            </div>
          </div>
        </Card>
      </section>
    </div>
  )
}
