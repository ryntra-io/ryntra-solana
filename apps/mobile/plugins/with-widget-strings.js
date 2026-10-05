const fs = require('node:fs')
const path = require('node:path')
const { withDangerousMod } = require('expo/config-plugins')

/**
 * The home-screen widget's name in the launcher's widget list, in the two
 * languages the app speaks. The widget library writes its label literally into
 * the manifest; `app.json` names the resource `@string/widget_portfolio_label`
 * there, and this plugin writes that resource — English by default, Ukrainian
 * where the phone speaks it. The picture beside the name in that list is the
 * widget as a new one first shows, «Під’єднай гаманець»: the library copies the
 * English one (`app.json` `previewImage`), this plugin puts the Ukrainian one
 * beside it under the same name. A picture, never a figure.
 */
const UK_PREVIEW = path.join('assets', 'images', 'widget-portfolio-preview-uk.png')

const LABELS = {
  values: 'Portfolio',
  'values-uk': 'Портфель',
}

function escape(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/'/g, "\\'")
}

module.exports = function withWidgetStrings(config) {
  return withDangerousMod(config, [
    'android',
    (modConfig) => {
      const res = path.join(modConfig.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res')
      for (const [folder, label] of Object.entries(LABELS)) {
        const dir = path.join(res, folder)
        fs.mkdirSync(dir, { recursive: true })
        fs.writeFileSync(
          path.join(dir, 'widget_strings.xml'),
          `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n  <string name="widget_portfolio_label">${escape(label)}</string>\n</resources>\n`,
        )
      }
      const ukDrawable = path.join(res, 'drawable-uk')
      fs.mkdirSync(ukDrawable, { recursive: true })
      fs.copyFileSync(
        path.join(modConfig.modRequest.projectRoot, UK_PREVIEW),
        path.join(ukDrawable, 'portfolio_preview.png'),
      )
      return modConfig
    },
  ])
}
