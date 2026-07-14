// Client-side PDF export of the live Docs panel → browser Downloads folder.

import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;
const MARGIN_MM = 10;

export async function exportElementToPdf(element: HTMLElement, filename: string): Promise<void> {
  const canvas = await html2canvas(element, {
    scale: 2,
    useCORS: true,
    backgroundColor: '#ffffff',
    logging: false,
    windowWidth: element.scrollWidth,
  });

  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const usableWidth = A4_WIDTH_MM - MARGIN_MM * 2;
  const usableHeight = A4_HEIGHT_MM - MARGIN_MM * 2;
  const imgWidth = usableWidth;
  const imgHeight = (canvas.height * imgWidth) / canvas.width;

  let heightLeft = imgHeight;
  let position = MARGIN_MM;
  const imgData = canvas.toDataURL('image/png');

  pdf.addImage(imgData, 'PNG', MARGIN_MM, position, imgWidth, imgHeight);
  heightLeft -= usableHeight;

  while (heightLeft > 0) {
    position = MARGIN_MM - (imgHeight - heightLeft);
    pdf.addPage();
    pdf.addImage(imgData, 'PNG', MARGIN_MM, position, imgWidth, imgHeight);
    heightLeft -= usableHeight;
  }

  // jsPDF.save() triggers a browser download → typically ~/Downloads
  pdf.save(filename);
}
