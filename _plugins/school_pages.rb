# One page for parents and carers at each school in _data/schools.json, at
# /<slug>/ (for example myphonemybrain.com/dua/), with the school's name on it
# and a button that opens the online form with the school already chosen
# (/take-part/consent/?who=parent&school=<slug>); parents can still change it
# there. The same list fills the form's school menu (consent-app/src/config/
# schools.ts), so adding a school is one line in _data/schools.json. Links in
# other capitals (/GSAL) reach the page through 404.html.
module MPMB
  class SchoolPage < Jekyll::Page
    def initialize(site, school)
      @site = site
      @base = site.source
      @dir = school['slug']
      @name = 'index.html'
      process(@name)
      @content = ''
      @data = {
        'layout' => 'school',
        'title' => "#{school['name']} | MyPhone/MyBrain",
        'description' => "#{school['name']} is taking part in MyPhone/MyBrain. Information for parents and carers, and the online permission form.",
        'school' => school,
        # Reached from the link the school sends, not from search.
        'noindex' => true,
      }
    end
  end

  class SchoolPages < Jekyll::Generator
    safe true

    def generate(site)
      schools = site.data['schools'] || []
      seen = {}
      schools.each do |school|
        slug = school['slug'].to_s
        raise "_data/schools.json: #{school['name'].inspect} needs a lower-case slug of letters, digits or hyphens" unless slug.match?(/\A[a-z0-9-]+\z/)
        raise "_data/schools.json: the slug #{slug.inspect} is used twice" if seen[slug]
        clash = site.pages.find { |p| p.url.split('/').reject(&:empty?).first == slug }
        raise "_data/schools.json: the slug #{slug.inspect} is already a page of the site (#{clash.url})" if clash
        seen[slug] = true
        site.pages << SchoolPage.new(site, school)
      end
    end
  end
end
