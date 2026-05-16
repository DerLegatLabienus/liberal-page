import JoinSelector from '@/components/parliament/JoinSelector'

export default function JoinSection() {
  return (
    <section id="join" className="bg-gradient-to-br from-blue-700 to-sky-600 py-16 text-center text-white">
      <div className="container mx-auto max-w-4xl px-4">
        <h2 className="mb-4 text-2xl font-bold">הצטרפו לליכוד</h2>
        <p className="mx-auto mb-8 max-w-xl text-base text-blue-100 leading-relaxed">
          בחרו את מסלול ההצטרפות, ונפנה אתכם לטופס הרשמי המתאים במערכת המאובטחת של הליברלים בליכוד.
        </p>
        <JoinSelector />
      </div>
    </section>
  )
}
