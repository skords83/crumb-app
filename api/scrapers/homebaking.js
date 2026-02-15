const scrapeHomebaking = ($) => {
  const title = $('h1').first().text().trim();
  const imageUrl = $('meta[property="og:image"]').attr('content') || "";

  let ingredients = [];
  $('.wprm-recipe-ingredient').each((_, el) => {
    const amount = $(el).find('.wprm-recipe-ingredient-amount').text().trim();
    const unit = $(el).find('.wprm-recipe-ingredient-unit').text().trim();
    const name = $(el).find('.wprm-recipe-ingredient-name').text().trim();
    if (name) {
      ingredients.push({
        name,
        amount: amount.replace(',', '.'),
        unit
      });
    }
  });

  let steps = [];
  $('.wprm-recipe-instruction-text').each((i, el) => {
    steps.push({
      instruction: $(el).text().trim(),
      step_order: i + 1
    });
  });

  return { title, imageUrl, ingredients, steps };
};

module.exports = scrapeHomebaking;