// Reviewed offline excerpts for Al-Baqarah 2:6. These are used only when
// both network providers fail; normal requests always prefer fresh API data.
const OFFLINE_EXCERPTS = {
  '2:6': {
    muyassar: 'إن الذين جحدوا ما أُنزل إليك من ربك استكبارًا وطغيانًا، لن يقع منهم الإيمان، سواء أخوَّفتهم وحذرتهم -أيها الرسول- من عذاب الله، أم تركت ذلك؛ لإصرارهم على باطلهم.',
    saadi: 'يخبر تعالى أن الذين كفروا، أي: اتصفوا بالكفر، وانصبغوا به، وصار وصفًا لهم لازمًا، لا يردعهم عنه رادع، ولا ينجع فيهم وعظ؛ إنهم مستمرون على كفرهم، فسواء عليهم أأنذرتهم أم لم تنذرهم لا يؤمنون. وحقيقة الكفر هو الجحود لما جاء به الرسول، أو جحد بعضه. فهؤلاء الكفار لا تفيدهم الدعوة إلا إقامة الحجة، وكأن في هذا قطعًا لطمع الرسول صلى الله عليه وسلم في إيمانهم، وأنك لا تأس عليهم، ولا تذهب نفسك عليهم حسرات.',
    baghawi: 'قوله: إن الذين كفروا، يعني مشركي العرب، قال الكلبي: يعني اليهود. والكفر هو الجحود، وأصله من الكفر وهو الستر، ومنه سمي الليل كافرًا لأنه يستر الأشياء بظلمته، وسمي الزُّرَّاع كافرًا لأنه يستر الحب بالتراب، والكافر يستر الحق بجحوده.',
  },
};

const FALLBACK_LABELS = {
  muyassar: 'التفسير الميسر',
  saadi: 'تفسير السعدي',
  baghawi: 'تفسير البغوي',
};

export function getBuiltInTafsir(sourceId, surah, ayah) {
  const verseKey = `${surah}:${ayah}`;
  const text = OFFLINE_EXCERPTS[verseKey]?.[sourceId];
  if (text) {
    return { text, source: FALLBACK_LABELS[sourceId], cached: true, fallback: true };
  }

  return {
    text: `لا يتوفر ${FALLBACK_LABELS[sourceId] || 'التفسير'} لهذه الآية دون اتصال. أعد الاتصال بالإنترنت لتحميله، وسيُحفظ بعدها على هذا الجهاز.`,
    source: FALLBACK_LABELS[sourceId] || 'التفسير',
    cached: false,
    fallback: true,
    unavailable: true,
  };
}
