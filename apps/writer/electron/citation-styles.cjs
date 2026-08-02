const GB_NUMERIC_CSL = `<?xml version="1.0" encoding="utf-8"?>
<style xmlns="http://purl.org/net/xbiblio/csl" version="1.0" class="in-text">
  <info>
    <title>笺间 GB/T 7714—2015 数字制</title>
    <id>https://jianjian.local/styles/gb-t-7714-2015-numeric</id>
    <updated>2026-01-01T00:00:00+00:00</updated>
  </info>
  <macro name="author">
    <names variable="author">
      <name name-as-sort-order="all" sort-separator=" " initialize-with="" delimiter="，"/>
      <substitute><text variable="publisher"/><text variable="title"/></substitute>
    </names>
  </macro>
  <macro name="issued"><date variable="issued"><date-part name="year"/></date></macro>
  <macro name="identifier">
    <choose>
      <if variable="DOI"><text variable="DOI" prefix="DOI:"/></if>
      <else><text variable="URL"/></else>
    </choose>
  </macro>
  <citation collapse="citation-number">
    <sort><key variable="citation-number"/></sort>
    <layout prefix="[" suffix="]" delimiter=","><text variable="citation-number"/></layout>
  </citation>
  <bibliography entry-spacing="0" second-field-align="flush">
    <layout>
      <text variable="citation-number" prefix="[" suffix="]"/>
      <group delimiter=". " suffix=".">
        <text macro="author"/>
        <text variable="title"/>
        <text variable="container-title"/>
        <text variable="publisher"/>
        <text macro="issued"/>
        <text variable="page"/>
        <text macro="identifier"/>
      </group>
    </layout>
  </bibliography>
</style>`;

const GB_AUTHOR_DATE_CSL = `<?xml version="1.0" encoding="utf-8"?>
<style xmlns="http://purl.org/net/xbiblio/csl" version="1.0" class="in-text">
  <info>
    <title>笺间 GB/T 7714—2015 作者-年份制</title>
    <id>https://jianjian.local/styles/gb-t-7714-2015-author-date</id>
    <updated>2026-01-01T00:00:00+00:00</updated>
  </info>
  <macro name="author">
    <names variable="author">
      <name name-as-sort-order="all" sort-separator=" " initialize-with="" delimiter="，"/>
      <substitute><text variable="publisher"/><text variable="title"/></substitute>
    </names>
  </macro>
  <macro name="author-short">
    <names variable="author">
      <name form="short" delimiter="，"/>
      <substitute><text variable="publisher"/><text variable="title" form="short"/></substitute>
    </names>
  </macro>
  <macro name="issued"><date variable="issued"><date-part name="year"/></date></macro>
  <citation disambiguate-add-year-suffix="true">
    <layout prefix="（" suffix="）" delimiter="；">
      <group delimiter="，"><text macro="author-short"/><text macro="issued"/><text variable="year-suffix"/></group>
    </layout>
  </citation>
  <bibliography entry-spacing="0">
    <sort><key macro="author"/><key macro="issued"/><key variable="title"/></sort>
    <layout suffix=".">
      <group delimiter=". ">
        <text macro="author"/>
        <group delimiter=""><text macro="issued"/><text variable="year-suffix"/></group>
        <text variable="title"/>
        <text variable="container-title"/>
        <text variable="publisher"/>
        <text variable="page"/>
        <choose><if variable="DOI"><text variable="DOI" prefix="DOI:"/></if><else><text variable="URL"/></else></choose>
      </group>
    </layout>
  </bibliography>
</style>`;

const MLA_9_CSL = `<?xml version="1.0" encoding="utf-8"?>
<style xmlns="http://purl.org/net/xbiblio/csl" version="1.0" class="in-text" default-locale="en-US">
  <info>
    <title>笺间 MLA 9</title>
    <id>https://jianjian.local/styles/mla-9</id>
    <updated>2026-01-01T00:00:00+00:00</updated>
  </info>
  <macro name="author">
    <names variable="author">
      <name name-as-sort-order="all" initialize-with=". " and="text"/>
      <substitute><text variable="title"/></substitute>
    </names>
  </macro>
  <macro name="author-short">
    <names variable="author"><name form="short"/><substitute><text variable="title" form="short"/></substitute></names>
  </macro>
  <citation>
    <layout prefix="(" suffix=")" delimiter="; ">
      <group delimiter=" "><text macro="author-short"/><text variable="locator"/></group>
    </layout>
  </citation>
  <bibliography>
    <sort><key macro="author"/><key variable="title"/></sort>
    <layout suffix=".">
      <group delimiter=". ">
        <text macro="author"/>
        <text variable="title" quotes="true"/>
        <text variable="container-title" font-style="italic"/>
        <text variable="publisher"/>
        <date variable="issued"><date-part name="year"/></date>
        <text variable="page"/>
        <choose><if variable="DOI"><text variable="DOI" prefix="https://doi.org/"/></if><else><text variable="URL"/></else></choose>
      </group>
    </layout>
  </bibliography>
</style>`;

const CHICAGO_AUTHOR_DATE_CSL = `<?xml version="1.0" encoding="utf-8"?>
<style xmlns="http://purl.org/net/xbiblio/csl" version="1.0" class="in-text" default-locale="en-US">
  <info>
    <title>笺间 Chicago Author-Date</title>
    <id>https://jianjian.local/styles/chicago-author-date</id>
    <updated>2026-01-01T00:00:00+00:00</updated>
  </info>
  <macro name="author">
    <names variable="author">
      <name name-as-sort-order="all" initialize-with=". " and="text"/>
      <substitute><text variable="title"/></substitute>
    </names>
  </macro>
  <macro name="author-short">
    <names variable="author"><name form="short" and="text"/><substitute><text variable="title" form="short"/></substitute></names>
  </macro>
  <macro name="issued"><date variable="issued"><date-part name="year"/></date></macro>
  <citation disambiguate-add-year-suffix="true">
    <layout prefix="(" suffix=")" delimiter="; ">
      <group delimiter=" "><text macro="author-short"/><text macro="issued"/><text variable="year-suffix"/></group>
    </layout>
  </citation>
  <bibliography>
    <sort><key macro="author"/><key macro="issued"/><key variable="title"/></sort>
    <layout suffix=".">
      <group delimiter=". ">
        <text macro="author"/>
        <group delimiter=""><text macro="issued"/><text variable="year-suffix"/></group>
        <text variable="title" quotes="true"/>
        <text variable="container-title" font-style="italic"/>
        <text variable="publisher"/>
        <text variable="page"/>
        <choose><if variable="DOI"><text variable="DOI" prefix="https://doi.org/"/></if><else><text variable="URL"/></else></choose>
      </group>
    </layout>
  </bibliography>
</style>`;

const BUILT_IN_STYLE_TEMPLATES = Object.freeze({
  "gb-t-7714-2015-numeric": {
    template: "jianjian-gb-t-7714-2015-numeric",
    xml: GB_NUMERIC_CSL,
    citationKind: "numeric",
  },
  "gb-t-7714-2015-author-date": {
    template: "jianjian-gb-t-7714-2015-author-date",
    xml: GB_AUTHOR_DATE_CSL,
    citationKind: "author-date",
  },
  "apa-7": {
    template: "apa",
    citationKind: "author-date",
  },
  "mla-9": {
    template: "jianjian-mla-9",
    xml: MLA_9_CSL,
    citationKind: "author-date",
  },
  "chicago-author-date": {
    template: "jianjian-chicago-author-date",
    xml: CHICAGO_AUTHOR_DATE_CSL,
    citationKind: "author-date",
  },
});

function registerBuiltInCitationStyles(styleRegister) {
  for (const definition of Object.values(BUILT_IN_STYLE_TEMPLATES)) {
    if (definition.xml && !styleRegister.has(definition.template)) {
      styleRegister.add(definition.template, definition.xml);
    }
  }
}

module.exports = {
  BUILT_IN_STYLE_TEMPLATES,
  registerBuiltInCitationStyles,
};
