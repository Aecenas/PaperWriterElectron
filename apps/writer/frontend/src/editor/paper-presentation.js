import { normalizeCustomBackgroundSource, toSafeCssImageUrl } from "../resource-safety.js";
import {
  TEMPLATES,
  fontStack,
  getLetterTemplate,
  normalizeTemplatePresentation,
} from "../templates/index.js";

export function getPaperPresentation(document, letterTemplates) {
  const selectedLetterTemplate = getLetterTemplate(document, letterTemplates);
  const customBackground = normalizeCustomBackgroundSource(document.customBackground);
  const customBackgroundCss = toSafeCssImageUrl(customBackground);
  const selectedPaperId = customBackground ? document.templateId : selectedLetterTemplate.paperId;
  const selectedTemplate = TEMPLATES.find((template) => template.id === selectedPaperId) || TEMPLATES[0];
  const typography = selectedLetterTemplate.typography;
  const presentation = normalizeTemplatePresentation(selectedLetterTemplate.presentation);
  return {
    selectedTemplate,
    typography,
    presentation,
    paperStyle: {
      "--paper-font": fontStack(typography.bodyFont),
      "--paper-font-size": `${typography.bodySize}px`,
      "--title-font": fontStack(typography.titleFont),
      "--title-size": `${typography.titleSize}px`,
      "--title-weight": typography.titleWeight,
      "--subtitle-font": fontStack(typography.subtitleFont),
      "--subtitle-size": `${typography.subtitleSize}px`,
      "--heading-font": fontStack(typography.headingFont),
      "--heading-size": `${typography.headingSize}px`,
      "--heading-weight": typography.headingWeight,
      "--quote-font": fontStack(typography.quoteFont),
      "--quote-size": `${typography.quoteSize}px`,
      "--toc-font": fontStack(typography.tocFont),
      "--toc-size": `${typography.tocSize}px`,
      "--image-caption-font": fontStack(typography.imageCaptionFont),
      "--image-caption-size": `${typography.imageCaptionSize}px`,
      "--paragraph-align": presentation.paragraphAlign,
      "--heading-color-1": presentation.headingColors[1],
      "--heading-color-2": presentation.headingColors[2],
      "--heading-color-3": presentation.headingColors[3],
      "--heading-color-4": presentation.headingColors[4],
      "--paper-repeat-bg": customBackgroundCss || `url("${selectedTemplate.slices.repeat}")`,
      "--paper-top-bg": customBackground ? "none" : `url("${selectedTemplate.slices.top}")`,
      "--paper-bottom-bg": customBackground ? "none" : `url("${selectedTemplate.slices.bottom}")`,
      "--paper-base": selectedTemplate.swatch,
    },
  };
}

